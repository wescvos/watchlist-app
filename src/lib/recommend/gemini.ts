import type { MediaKind } from "@/lib/types";
import type {
  RatedTitle,
  RawSuggestion,
  RecommendationRequest,
  RecommendationProvider,
} from "./types";

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
export const GEMINI_MODEL = "gemini-flash-latest";

const ENDPOINT = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`;

// Give up on Gemini after this; the API route turns a timeout into "keep the
// cached set" rather than hanging the screen.
const TIMEOUT_MS = 20_000;
// gemini-flash-latest is a "thinking" model: its reasoning tokens
// (thoughtsTokenCount, seen at ~1,000-1,600) share this budget with the actual
// JSON output. 2048 left too little headroom, so a rich history truncated the
// JSON mid-array -> parse dropped everything -> "no valid suggestions". 8192
// comfortably fits thinking + a full set. (thinkingBudget:0 is rejected 400 on
// this model, so raising the ceiling is the lever, not disabling thinking.)
const MAX_OUTPUT_TOKENS = 8192;
const TARGET_COUNT = 12;
const REASON_MAX_LEN = 200;

// Thrown for genuine failures (non-200, network, timeout, no-text, malformed
// JSON). A well-formed but empty result is NOT thrown — it's graceful
// exhaustion. The `kind` discriminator lets the API route map rate-limit → 429
// and timeout → 504 without string-matching the message.
export type RecommendationErrorKind = "timeout" | "rate_limit" | "failure";

export class RecommendationError extends Error {
  readonly kind: RecommendationErrorKind;
  readonly cause?: unknown;
  constructor(message: string, kind: RecommendationErrorKind = "failure", cause?: unknown) {
    super(message);
    this.name = "RecommendationError";
    this.kind = kind;
    this.cause = cause;
  }
}

// Structured-output schema for the legacy generateContent path: an array of
// objects. `year` is intentionally NOT required, so the model may omit it and
// the parser coerces to null. This avoids depending on `nullable` support,
// which the docs don't confirm for this path.
const RESPONSE_SCHEMA = {
  type: "array",
  items: {
    type: "object",
    properties: {
      title: { type: "string" },
      year: { type: "integer" },
      mediaType: { type: "string", enum: ["MOVIE", "TV"] },
      reason: { type: "string" },
    },
    required: ["title", "mediaType", "reason"],
  },
} as const;

// PRIVACY: only the whitelist (title, year, mediaType, myRating) is serialized
// into the prompt, assembled explicitly here — never a whole Title row. A field
// added to Title later cannot leak through this path.
function buildPrompt(history: RatedTitle[]): string {
  const ratings = history.map((t) => ({
    title: t.title,
    year: t.year,
    type: t.mediaType,
    rating: t.myRating,
  }));
  return [
    "You are a film and TV recommendation engine.",
    "Below is one person's watch history with the personal rating (0-10) they gave each title.",
    "Recommend titles they have NOT listed that fit their taste, favouring what their higher-rated titles have in common (genre, tone, era, director, cast).",
    "Favour less-obvious, deeper-cut picks over the most predictable neighbours — adjacent genres, directors, and eras that a knowledgeable friend would suggest, not just the algorithm's top hit.",
    `Return at most ${TARGET_COUNT} suggestions as a JSON array matching the provided schema.`,
    "Each 'reason' must be a single concise sentence tying the pick to their taste.",
    "Do not recommend any title already present in the history below.",
    "",
    "Watch history (JSON):",
    JSON.stringify(ratings),
  ].join("\n");
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

function coerceSuggestion(item: unknown): RawSuggestion | null {
  if (!item || typeof item !== "object") return null;
  const o = item as Record<string, unknown>;
  const title = typeof o.title === "string" ? o.title.trim() : "";
  if (!title) return null;
  const mediaType: MediaKind | null =
    o.mediaType === "MOVIE" || o.mediaType === "TV" ? o.mediaType : null;
  if (!mediaType) return null;
  const reasonRaw = typeof o.reason === "string" ? o.reason.trim() : "";
  if (!reasonRaw) return null;
  const reason = reasonRaw.length > REASON_MAX_LEN ? reasonRaw.slice(0, REASON_MAX_LEN) : reasonRaw;
  const year = typeof o.year === "number" && Number.isFinite(o.year) ? Math.trunc(o.year) : null;
  return { title, year, mediaType, reason };
}

// Drop-invalid-but-keep-valid: malformed ENTRIES are skipped, not fatal. An
// empty result (all entries invalid, or a genuinely empty array) is returned
// as [] — the service treats "nothing to recommend" as graceful exhaustion,
// not a failure. Parsing the array itself (malformed/truncated JSON) is handled
// by the caller, which treats that as a genuine failure.
export function coerceSuggestions(items: unknown[]): RawSuggestion[] {
  const out: RawSuggestion[] = [];
  for (const item of items) {
    const s = coerceSuggestion(item);
    if (s) out.push(s);
  }
  return out;
}

export class GeminiRecommendationProvider implements RecommendationProvider {
  readonly model = GEMINI_MODEL;

  async recommend(req: RecommendationRequest): Promise<RawSuggestion[]> {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) throw new RecommendationError("GEMINI_API_KEY is not set");

    const promptText = buildPrompt(req.history);
    const body = {
      contents: [{ role: "user", parts: [{ text: promptText }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        // Modest bump from 0.7 for more varied picks; structured-output mode +
        // the responseSchema still hold the JSON contract, so this doesn't risk
        // malformed output.
        temperature: 0.9,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
      },
    };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(ENDPOINT, {
        method: "POST",
        headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (e) {
      const aborted = controller.signal.aborted;
      throw new RecommendationError(
        aborted ? "Gemini request timed out" : "Gemini request failed",
        aborted ? "timeout" : "failure",
        e,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      // Log Gemini's error body server-side — it names the real cause (invalid
      // key, model not found/retired, quota, bad schema) that the client's
      // generic status hides. Never logs the key. (A retired model id here is
      // exactly what this once masked.)
      const errorBody = await res.text().catch(() => "<unreadable>");
      console.error(`[recommend] Gemini non-200 status=${res.status} body=${errorBody.slice(0, 1200)}`);
      // 429 is the free-tier daily/minute cap — tagged so the screen can show
      // an honest "try again tomorrow" instead of a generic error.
      if (res.status === 429) throw new RecommendationError("Gemini rate limit reached", "rate_limit");
      throw new RecommendationError(`Gemini returned ${res.status}`);
    }

    const data = await res.json().catch(() => null);
    const text = extractText(data);
    // Concise, permanent breadcrumb on the empty-output/failure paths:
    // finishReason + token usage is exactly what catches a recurrence of
    // thinking-token starvation (MAX_TOKENS, thoughts high, candidates
    // truncated). No content, key, or history logged.
    if (text == null) {
      console.error(`[recommend] no text part: finishReason=${getFinishReason(data)} usage=${summarizeUsage(data)}`);
      throw new RecommendationError("Gemini response had no text part");
    }

    // A parseable array (even empty / all-invalid) is a fine response — the
    // service treats "nothing new" as exhaustion, not an error. Only genuinely
    // malformed or truncated JSON is a failure.
    let parsed: unknown;
    try {
      parsed = JSON.parse(text);
    } catch {
      console.error(`[recommend] malformed JSON: finishReason=${getFinishReason(data)} usage=${summarizeUsage(data)}`);
      throw new RecommendationError("Gemini returned malformed JSON");
    }
    if (!Array.isArray(parsed)) {
      console.error(`[recommend] non-array response: finishReason=${getFinishReason(data)} usage=${summarizeUsage(data)}`);
      throw new RecommendationError("Gemini response was not a JSON array");
    }
    return coerceSuggestions(parsed);
  }
}
