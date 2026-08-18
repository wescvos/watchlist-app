import { prisma } from "@/lib/prisma";
import { generateJson, GeminiError, resolveModel } from "@/lib/gemini/client";
import { MOODS, MOOD_LABELS, MOOD_DISAMBIGUATION, MOOD_EXAMPLES, isMoodLabel } from "@/lib/moods";
import { isCloseMatch } from "@/lib/tmdbMatch";
import type { MediaKind } from "@/lib/types";

/**
 * Mood tagging: one Gemini call classifies a batch of titles against the eleven
 * moods, and the result is stored on the row. Browsing moods is then a plain
 * database filter, so no LLM call ever sits on a user-facing path.
 */

// Sized against maxOutputTokens (8192), which this model shares between its
// reasoning tokens and the JSON it emits. At 20 titles the budget lands near
// 4,800 (~200 thinking + ~40 output per title), leaving ~40% headroom; 30 would
// sit at ~88%, which is the starvation shape that once truncated responses to
// nothing. It also sets the backfill's request count: 327 Want titles is 17
// requests against a 20/day free tier. Changing this needs the spec's
// arithmetic redone, not a guess. See the design spec, section 7.
export const TAG_BATCH_SIZE = 20;

// Enough of a TMDb overview to carry premise and tone, which is all a mood
// judgement needs, while bounding per-title input cost.
export const OVERVIEW_MAX_CHARS = 400;

// REQUIRED PACING, NOT POLITENESS. DO NOT REMOVE OR SHORTEN.
//
// The Gemini free tier caps requests per MINUTE at 5, separately from the 20
// per day. Firing batches back to back would 429 on the 6th request inside the
// first minute: the daily budget would still show 15 requests left, but a
// 17-batch backfill would have tagged only 100 of 327 titles and stopped.
// 15s spacing holds the rate at 4/minute, one under the cap. A full backfill
// then takes ~4 minutes, which costs nothing for a one-off script.
//
// Defaults ON, so a caller that loops many batches is paced whether or not it
// remembers to ask. Only tests set it to 0.
export const INTER_REQUEST_DELAY_MS = 15_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Classification, not generation: keep it near-deterministic. (The removed
// recommend path used 0.9, which was tuned for variety in invented picks.)
const TEMPERATURE = 0.2;

// The client's 20s default is sized for a user-facing path, where a hung request
// must not hang a screen. Tagging has nobody waiting: it runs inside after() or
// from a script. And 20s turned out to be marginal here, which is the worst
// case: on 2026-08-17 four of five batches aborted at 20s while one finished in
// ~18s, so a 20-title classification sits right on that edge. An abort still
// spends the request, and Gemini may well have completed the work we walked away
// from, so a short timeout burns quota to produce nothing. Be generous.
const TAG_TIMEOUT_MS = 120_000;

/** Exactly what leaves the app per title. Assembled explicitly; never a Title row. */
export interface TaggableTitle {
  index: number;
  title: string;
  year: number | null;
  mediaType: MediaKind;
  genres: string[];
  overview: string | null;
}

export interface MoodTagging {
  index: number;
  moods: string[];
}

export interface TagProgress {
  /** 1-based batch number. */
  requestNumber: number;
  totalRequests: number;
  batchSize: number;
  /** Real requests already spent this run, retries included. */
  requestsSpent: number;
  /** The run's ceiling, if one was set. */
  requestBudget: number | null;
  /** The model serving this request. */
  model: string;
  /** Since tagTitles started. */
  elapsedMs: number;
  /** Since the previous request began, so pacing is visible. Null on the first. */
  sinceLastMs: number | null;
}

export interface TagOptions {
  onRequest?: (progress: TagProgress) => void;
  /** Overrides INTER_REQUEST_DELAY_MS. Only tests should pass 0. */
  delayMs?: number;
  /** Overrides the rolling model alias for this run. See resolveModel. */
  model?: string;
  /** Test seam, forwarded to the client. */
  retryDelaysMs?: number[];
  /** Overrides TAG_TIMEOUT_MS. */
  timeoutMs?: number;
  /**
   * Hard ceiling on REAL HTTP requests for this run, retries included.
   *
   * The run stops before exceeding it rather than discovering the limit via a
   * 429. Retries are also clamped to what remains, so the very last request in
   * the budget is spent on a fresh batch rather than on a retry that would
   * overshoot.
   */
  requestBudget?: number;
}

// Stop a run when the model is simply down. On 2026-08-17 the alias rolled onto
// a just-released model that 503'd on every call, and the backfill spent 17 of
// the day's 20 requests discovering that one batch at a time. Three consecutive
// batch failures is enough evidence: stop and report, leaving the budget for a
// retry against a model that works. A single success resets the counter, since
// intermittent failures are the case retrying is for.
const MAX_CONSECUTIVE_BATCH_FAILURES = 3;

// One retry, matching the client default. Named here so a caller can show the
// worst-case request cost per batch (1 + this length) when planning a budget.
export const DEFAULT_TAG_RETRY_DELAYS = [15_000];

/** Why a run ended before working through every batch. */
export type TagStopReason = "consecutive_failures" | "rate_limit" | "budget_exhausted";

export interface TagResult {
  tagged: number;
  /** Titles in a batch whose request failed. Titles the model simply omitted are
   *  in neither count: they stay untagged and the next run picks them up. */
  failed: number;
  /**
   * REAL HTTP requests, retries included, which is what the daily quota counts.
   *
   * This used to count batches, so retries were invisible: a run reported "10 of
   * 20 used" while it had actually spent all 20 and then died on a 429.
   */
  requests: number;
  /** Batches attempted, which is the old meaning of `requests`. */
  batches: number;
  /** Which model actually served the requests. */
  model: string;
  /** Absent when every batch was attempted. */
  stoppedReason?: TagStopReason;
}

export const MOOD_RESPONSE_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      index: { type: "integer" },
      // Required, not optional: an entry we cannot cross-check against the
      // batch is exactly the one that could write moods onto the wrong film.
      title: { type: "string" },
      moods: { type: "array", items: { type: "string", enum: [...MOOD_LABELS] } },
    },
    required: ["index", "title", "moods"],
  },
} as const;

export function truncateOverview(overview: string | null): string | null {
  if (overview == null) return null;
  if (overview.length <= OVERVIEW_MAX_CHARS) return overview;
  const cut = overview.slice(0, OVERVIEW_MAX_CHARS);
  const lastSpace = cut.lastIndexOf(" ");
  // Cut at a word boundary so the model never sees a severed word, unless the
  // whole window is one long token.
  return (lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd();
}

// PRIVACY: the payload is built field by field from the whitelist below, so a
// column added to Title later cannot leak through this path even if a caller
// hands over a richer object. Ratings, notes, watch dates, and pinned state
// never appear.
function toPayload(t: TaggableTitle) {
  return {
    index: t.index,
    title: t.title,
    year: t.year,
    type: t.mediaType,
    genres: t.genres,
    overview: truncateOverview(t.overview),
  };
}

export function buildTagPrompt(batch: TaggableTitle[]): string {
  const moodLines = MOODS.map((m) => `- ${m.label}: ${m.definition}`);
  return [
    "You are tagging films and series with the moods a viewer might be in the mood for.",
    "",
    "THE MOODS (use these labels exactly, and no others):",
    ...moodLines,
    "",
    "KEEPING NEIGHBOURING MOODS DISTINCT:",
    ...MOOD_DISAMBIGUATION.map((d) => `- ${d}`),
    "",
    "MULTIPLE MOODS PER TITLE ARE CORRECT AND EXPECTED:",
    ...MOOD_EXAMPLES.map((e) => `- ${e}`),
    "",
    "RULES:",
    "- Assign every mood that genuinely applies, and no mood that merely partly fits. Typically 1 to 4.",
    "- An empty list is a valid answer if no mood genuinely applies. Do not stretch to find one.",
    "- Judge each mood on its own criteria. They are separate axes, not synonyms.",
    "- Return one entry per title given, echoing back its index and title exactly as provided.",
    "",
    "TITLES (JSON):",
    JSON.stringify(batch.map(toPayload)),
  ].join("\n");
}

function coerceEntry(item: unknown, batch: TaggableTitle[]): MoodTagging | null {
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;

  if (typeof o.index !== "number" || !Number.isInteger(o.index)) return null;
  if (o.index < 0 || o.index >= batch.length) return null;

  // Alignment guard. The model echoes the title back, and it must still be the
  // title we sent at that index. A shifted or hallucinated response would
  // otherwise write one film's moods onto another, which is worse than leaving
  // the row untagged. isCloseMatch (the shared TMDb matcher) tolerates case,
  // punctuation, and diacritics while rejecting a genuinely different title.
  if (typeof o.title !== "string" || !o.title.trim()) return null;
  if (!isCloseMatch(o.title, batch[o.index].title)) return null;

  if (!Array.isArray(o.moods)) return null;

  // Unknown labels are dropped one by one rather than failing the entry: the
  // remaining valid moods are still good information. An entry left with none
  // is a legitimate "no mood applies" result, not a failure.
  const moods: string[] = [];
  for (const m of o.moods) {
    if (typeof m === "string" && isMoodLabel(m) && !moods.includes(m)) moods.push(m);
  }
  return { index: o.index, moods };
}

/**
 * Drop-invalid-but-keep-valid. A malformed ENTRY is skipped, never fatal, so a
 * partly-good batch still tags what it can. Only a non-array response (the
 * shape contract itself being broken) throws.
 */
export function parseMoodTaggings(raw: unknown, batch: TaggableTitle[]): MoodTagging[] {
  if (!Array.isArray(raw)) throw new Error("Mood response was not a JSON array");
  const out: MoodTagging[] = [];
  const seen = new Set<number>();
  for (const item of raw) {
    const entry = coerceEntry(item, batch);
    if (!entry || seen.has(entry.index)) continue;
    seen.add(entry.index);
    out.push(entry);
  }
  return out;
}

function toBatches<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/**
 * Tag the given titles, in batches. Writes are per title, not per batch, so a
 * response covering 18 of 20 tags those 18 and leaves the rest for next time.
 *
 * Requests are paced by INTER_REQUEST_DELAY_MS to stay under the free tier's
 * 5-per-minute limit; a single-batch call never waits.
 *
 * Throws only on a rate limit, where continuing would waste every remaining
 * batch on a guaranteed failure. Any other Gemini failure fails that batch
 * alone and the run continues.
 */
export async function tagTitles(ids: string[], opts: TagOptions = {}): Promise<TagResult> {
  const model = resolveModel(opts.model);
  if (ids.length === 0) {
    return { tagged: 0, failed: 0, requests: 0, batches: 0, model };
  }

  const rows = await prisma.title.findMany({
    where: { id: { in: ids } },
    // Explicit select: personal columns never even enter memory on this path.
    select: { id: true, title: true, year: true, mediaType: true, genres: true, overview: true },
  });

  const batches = toBatches(rows, TAG_BATCH_SIZE);
  const delayMs = opts.delayMs ?? INTER_REQUEST_DELAY_MS;
  const startedAt = Date.now();
  let lastRequestAt: number | null = null;
  const budget = opts.requestBudget ?? null;
  const configuredRetries = opts.retryDelaysMs ?? DEFAULT_TAG_RETRY_DELAYS;
  let tagged = 0;
  let failed = 0;
  // Real HTTP requests, incremented by the client via onAttempt so retries count.
  let requests = 0;
  let batchesAttempted = 0;
  let consecutiveFailures = 0;
  let stoppedReason: TagStopReason | undefined;

  for (const rowBatch of batches) {
    // Stop BEFORE overspending rather than learning the limit from a 429.
    if (budget !== null && requests >= budget) {
      console.error(
        `[mood] stopping: request budget of ${budget} is spent (${requests} used). ` +
          `${batches.length - batchesAttempted} batch(es) left for the next run.`,
      );
      stoppedReason = "budget_exhausted";
      break;
    }

    // Stay under the per-minute cap. Before each request except the first, so a
    // single-batch call (the add/refresh path) never waits.
    if (lastRequestAt !== null && delayMs > 0) await sleep(delayMs);

    // Indices are batch-local, so the model always counts from zero.
    const batch: TaggableTitle[] = rowBatch.map((r, i) => ({
      index: i,
      title: r.title,
      year: r.year,
      mediaType: r.mediaType as MediaKind,
      genres: r.genres,
      overview: r.overview,
    }));

    batchesAttempted++;
    const requestAt = Date.now();
    opts.onRequest?.({
      requestNumber: batchesAttempted,
      totalRequests: batches.length,
      batchSize: batch.length,
      requestsSpent: requests,
      requestBudget: budget,
      model,
      elapsedMs: requestAt - startedAt,
      sinceLastMs: lastRequestAt === null ? null : requestAt - lastRequestAt,
    });
    lastRequestAt = requestAt;

    // Clamp retries to what the budget can actually afford, so the last request
    // available goes to a fresh batch rather than to a retry that overshoots.
    const affordable = budget === null ? configuredRetries.length : Math.max(0, budget - requests - 1);
    const retryDelaysMs = configuredRetries.slice(0, affordable);

    let taggings: MoodTagging[];
    try {
      const raw = await generateJson({
        prompt: buildTagPrompt(batch),
        responseSchema: MOOD_RESPONSE_SCHEMA,
        logPrefix: "[mood]",
        temperature: TEMPERATURE,
        expectArray: true,
        model: opts.model,
        retryDelaysMs,
        timeoutMs: opts.timeoutMs ?? TAG_TIMEOUT_MS,
        onAttempt: () => {
          requests++;
        },
      });
      taggings = parseMoodTaggings(raw, batch);
      consecutiveFailures = 0;
    } catch (e) {
      failed += batch.length;
      // A rate limit ends the run, but it must NOT throw: throwing discarded
      // every counter, which is why a drained run once reported "Tagged 0,
      // failed 0, using 0 request(s)" directly above DB counts proving
      // otherwise. Stop, record why, and return what actually happened.
      if (e instanceof GeminiError && e.kind === "rate_limit") {
        console.error(
          `[mood] stopping: rate limit reached on model=${model} after ${requests} request(s). ` +
            `${batches.length - batchesAttempted} batch(es) left for the next run.`,
        );
        stoppedReason = "rate_limit";
        break;
      }
      console.error(`[mood] batch of ${batch.length} failed: ${e instanceof Error ? e.message : String(e)}`);
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_CONSECUTIVE_BATCH_FAILURES) {
        console.error(
          `[mood] stopping after ${consecutiveFailures} consecutive batch failures on model=${model}. ` +
            "The model looks unavailable; a further attempt would spend quota to learn nothing.",
        );
        stoppedReason = "consecutive_failures";
        break;
      }
      continue;
    }

    const now = new Date();
    for (const t of taggings) {
      // moodsTaggedAt is stamped even for an empty mood list, so a title that
      // legitimately matches nothing is never re-asked.
      await prisma.title.update({
        where: { id: rowBatch[t.index].id },
        data: { moods: t.moods, moodsTaggedAt: now },
      });
      tagged++;
    }
  }

  return { tagged, failed, requests, batches: batchesAttempted, model, stoppedReason };
}

/**
 * Tag a title only if it has never been tagged.
 *
 * The gate is what keeps the daily quota bounded: refreshTitle() runs
 * automatically for any row older than 30 days when its page is viewed, so
 * tagging on every refresh would let a browsing session spend the whole
 * allowance. Never rejects, because callers schedule it with after() where an
 * unhandled rejection has nowhere to go.
 */
export async function tagIfUntagged(id: string): Promise<void> {
  try {
    const row = await prisma.title.findUnique({ where: { id }, select: { id: true, moodsTaggedAt: true } });
    if (!row || row.moodsTaggedAt) return;
    await tagTitles([id]);
  } catch (e) {
    console.error(`[mood] tagIfUntagged(${id}) failed: ${e instanceof Error ? e.message : String(e)}`);
  }
}
