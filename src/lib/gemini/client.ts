// Shared Gemini plumbing: one place that knows the endpoint, the auth header,
// JSON mode, the timeout, and how to read a response without exploding on a
// shape change. Extracted verbatim from the (now removed) recommend provider,
// comments included — every note below records something that actually broke
// once, so none of it is decoration.
//
// Callers own their prompt, their responseSchema, and their validation. This
// module owns the transport and the failure taxonomy.

// gemini-2.5-flash was retired for NEW API keys (404 "no longer available to
// new users"), so we use the rolling `-latest` alias, which always resolves to
// the current stable flash model and won't go stale the same way. Verified
// 2026-07-22 against this key: 200, finishReason STOP, valid JSON array.
// Served from the classic `generateContent` endpoint; structured output uses
// generationConfig's responseMimeType + responseSchema, JSON at
// candidates[0].content.parts[0].text. (The newer Interactions API with
// `responseFormat` is a separate surface we deliberately do not use.)
// To pin a concrete version instead of the alias, gemini-3.5-flash is verified
// working with the same request shape.
//
// THE ALIAS MOVES, and that cuts both ways. It protects against retired models,
// but on 2026-08-17 it rolled onto Gemini 3.7 Flash the day that model shipped,
// and every request 503'd with "experiencing high demand" while the 503s still
// counted against the daily quota. The alias saved us from a 404 and walked us
// into an overloaded brand-new model.
//
// So: prefer the alias by default, but override it deliberately when the alias
// lands somewhere unstable. Rate limits are PER MODEL, so switching models also
// switches to a fresh budget. See resolveModel below.
export const GEMINI_MODEL = "gemini-flash-latest";

/**
 * Which model a call will use. Precedence: explicit argument, then the
 * GEMINI_MODEL_OVERRIDE env var, then the rolling alias.
 *
 * The override exists for the case above: pinning temporarily to a known-good
 * version when the alias is unstable. It is deliberate and reversible, not a
 * standing pin, and the app's default stays the alias.
 */
export function resolveModel(model?: string): string {
  return model ?? process.env.GEMINI_MODEL_OVERRIDE ?? GEMINI_MODEL;
}

function endpointFor(model: string): string {
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
}

// A 5xx from Gemini means "busy, try again", and it says so in the body. Worth
// ONE retry, unlike a 429 (retrying a rate limit is the opposite of helpful) or
// any 4xx (a bad key or schema will fail identically forever).
//
// ONE retry, not two, and the reasoning matters. Every attempt including a
// failed one is billable against a 20-per-day cap, and 503 "high demand" is a
// sustained server-load condition, so attempts are CORRELATED rather than
// independent: a retry 15s later usually meets the same overload. On 2026-08-17
// a 17-batch run 503'd on 16 batches, and on 2026-08-18 most batches needed 2-3
// attempts, which silently doubled real usage and drained the day at batch 10.
//
// The objective is maximum titles tagged per unit of quota, not maximum batches
// rescued. Given a resume-safe caller, a doomed batch costs nothing but the one
// request, whereas three attempts on it cost two batches that would each have
// had a fresh chance. One retry still catches a genuinely transient blip, which
// does happen, without funding a lost cause.
//
// The delay is >= the 15s that keeps a batch loop under the 5-requests-per-minute
// cap, so a retry cannot itself trip that limit.
const RETRY_DELAYS_MS = [15_000];

function isRetryableStatus(status: number): boolean {
  return status >= 500 && status < 600;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Give up on Gemini after this. Callers that sit on a user-facing path turn a
// timeout into "keep what we had" rather than hanging the screen.
const DEFAULT_TIMEOUT_MS = 20_000;

// gemini-flash-latest is a "thinking" model: its reasoning tokens
// (thoughtsTokenCount, seen at ~1,000-1,600) share this budget with the actual
// JSON output. 2048 left too little headroom, so a rich prompt truncated the
// JSON mid-array -> parse dropped everything -> empty result. 8192 comfortably
// fits thinking + a full response. (thinkingBudget:0 is rejected 400 on this
// model, so raising the ceiling is the lever, not disabling thinking.)
//
// Anything that batches work into one call must size its batch against this
// ceiling, because reasoning and output share it.
export const MAX_OUTPUT_TOKENS = 8192;

// Thrown for genuine failures (non-200, network, timeout, no-text, malformed
// JSON). The `kind` discriminator lets callers map rate_limit and timeout to
// their own handling without string-matching the message.
export type GeminiErrorKind = "timeout" | "rate_limit" | "failure";

export class GeminiError extends Error {
  readonly kind: GeminiErrorKind;
  readonly cause?: unknown;
  constructor(message: string, kind: GeminiErrorKind = "failure", cause?: unknown) {
    super(message);
    this.name = "GeminiError";
    this.kind = kind;
    this.cause = cause;
  }
}

function getFinishReason(data: unknown): string {
  if (!data || typeof data !== "object") return "<none>";
  const candidates = (data as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return "<none>";
  const fr = (candidates[0] as { finishReason?: unknown }).finishReason;
  return typeof fr === "string" ? fr : "<none>";
}

// Token counts only (no content) — thoughtsTokenCount is the tell for a
// thinking model eating the output budget before emitting JSON.
function summarizeUsage(data: unknown): string {
  const u = (data as { usageMetadata?: Record<string, unknown> })?.usageMetadata;
  if (!u || typeof u !== "object") return "<none>";
  return `prompt=${u.promptTokenCount} thoughts=${u.thoughtsTokenCount} candidates=${u.candidatesTokenCount} total=${u.totalTokenCount}`;
}

// candidates[0].content.parts[0].text, guarded at every hop so a shape change
// degrades to null (caller treats as failure) instead of throwing a TypeError.
function extractText(data: unknown): string | null {
  if (!data || typeof data !== "object") return null;
  const candidates = (data as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates) || candidates.length === 0) return null;
  const parts = (candidates[0] as { content?: { parts?: unknown } })?.content?.parts;
  if (!Array.isArray(parts) || parts.length === 0) return null;
  const text = (parts[0] as { text?: unknown })?.text;
  return typeof text === "string" ? text : null;
}

export interface GenerateJsonOptions {
  prompt: string;
  // Gemini responseSchema. It reduces malformed output but does not guarantee
  // it, so callers still validate what comes back.
  responseSchema: object;
  // Prefixes every log line, e.g. "[mood]". Makes a breadcrumb attributable
  // when more than one caller shares this module.
  logPrefix: string;
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  // Enforce a top-level JSON array here rather than in the caller, purely so
  // the "not an array" breadcrumb can log finishReason + token usage, which is
  // only in scope inside this function. Callers still validate entries.
  expectArray?: boolean;
  /** Overrides the rolling alias. See resolveModel. */
  model?: string;
  /** Test seam only: skip the real backoff waits. Also caps attempts to length+1. */
  retryDelaysMs?: number[];
  /**
   * Called immediately before every HTTP attempt, including retries.
   *
   * This is how a caller counts REAL requests. Counting batches instead is what
   * made the budget line lie: retries were invisible, so the script believed it
   * had spent 10 of 20 when it had actually spent all 20.
   */
  onAttempt?: () => void;
}

/**
 * POST a prompt to Gemini in JSON mode and return the parsed response.
 *
 * Retries a 5xx ONCE with backoff, since that is Gemini saying it is busy. Does NOT retry a 429 (a rate limit needs waiting out, not hammering) or
 * any 4xx (a bad key, model id, or schema fails identically forever).
 *
 * Throws `GeminiError` for genuine failures: missing key, non-200 (429 tagged
 * `rate_limit`), network error, timeout (`timeout`), no text part, or
 * unparseable JSON. A well-formed but empty response is NOT an error; that
 * judgement belongs to the caller.
 */
export async function generateJson(opts: GenerateJsonOptions): Promise<unknown> {
  const { prompt, responseSchema, logPrefix, expectArray = false } = opts;
  const model = resolveModel(opts.model);
  const endpoint = endpointFor(model);
  const retryDelays = opts.retryDelaysMs ?? RETRY_DELAYS_MS;
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new GeminiError("GEMINI_API_KEY is not set");

  const body = {
    contents: [{ role: "user", parts: [{ text: prompt }] }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema,
      // Omitted entirely when the caller doesn't care, so the API default
      // applies rather than a value invented here. Structured-output mode plus
      // the responseSchema hold the JSON contract either way, so temperature
      // does not risk malformed output.
      ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}),
      maxOutputTokens: opts.maxOutputTokens ?? MAX_OUTPUT_TOKENS,
    },
  };

  let res: Response | null = null;
  for (let attempt = 0; attempt <= retryDelays.length; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    // Before the fetch, so an attempt that throws is still counted: it reached
    // the API and is billable either way.
    opts.onAttempt?.();
    try {
      res = await fetch(endpoint, {
        method: "POST",
        // Key travels in the header, never the URL, so it cannot end up in a log
        // or an error body echoing the request line.
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      const aborted = controller.signal.aborted;
      throw new GeminiError(
        aborted ? "Gemini request timed out" : "Gemini request failed",
        aborted ? "timeout" : "failure",
        e,
      );
    } finally {
      clearTimeout(timer);
    }

    if (res.ok) break;

    // Log Gemini's error body server-side — it names the real cause (invalid
    // key, model not found/retired, quota, bad schema) that the caller's
    // generic status hides. Never logs the key. (A retired model id here is
    // exactly what this once masked.)
    const errorBody = await res.text().catch(() => "<unreadable>");
    console.error(`${logPrefix} Gemini non-200 model=${model} status=${res.status} body=${errorBody.slice(0, 1200)}`);

    // 429 is the free-tier cap, per MODEL and both per-day and per-minute.
    // Tagged so callers can stop rather than hammer, and never retried here.
    if (res.status === 429) throw new GeminiError("Gemini rate limit reached", "rate_limit");

    const canRetry = isRetryableStatus(res.status) && attempt < retryDelays.length;
    if (!canRetry) throw new GeminiError(`Gemini returned ${res.status}`);

    const wait = retryDelays[attempt];
    console.error(
      `${logPrefix} retrying after ${res.status} in ${Math.round(wait / 1000)}s ` +
        `(attempt ${attempt + 2} of ${retryDelays.length + 1})`,
    );
    await sleep(wait);
  }

  if (!res) throw new GeminiError("Gemini request produced no response");

  const data = await res.json().catch(() => null);
  const text = extractText(data);
  // Concise, permanent breadcrumb on the empty-output/failure paths:
  // finishReason + token usage is exactly what catches a recurrence of
  // thinking-token starvation (MAX_TOKENS, thoughts high, candidates
  // truncated). No content, key, or prompt logged.
  if (text == null) {
    console.error(`${logPrefix} no text part: model=${model} finishReason=${getFinishReason(data)} usage=${summarizeUsage(data)}`);
    throw new GeminiError("Gemini response had no text part");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    console.error(`${logPrefix} malformed JSON: model=${model} finishReason=${getFinishReason(data)} usage=${summarizeUsage(data)}`);
    throw new GeminiError("Gemini returned malformed JSON");
  }
  if (expectArray && !Array.isArray(parsed)) {
    console.error(`${logPrefix} non-array response: model=${model} finishReason=${getFinishReason(data)} usage=${summarizeUsage(data)}`);
    throw new GeminiError("Gemini response was not a JSON array");
  }
  return parsed;
}
