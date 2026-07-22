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
// Ceilings so one oversized response can't blow the free-tier token budget or
// the layout. The model is also told the target count in the prompt.
const MAX_OUTPUT_TOKENS = 2048;
const TARGET_COUNT = 12;
const REASON_MAX_LEN = 200;

// Thrown for every failure mode (non-200, network, timeout, empty/invalid
// output). The `kind` discriminator lets the API route map a timeout to 504
// and everything else to 502 without string-matching the message.
export type RecommendationErrorKind = "timeout" | "failure";

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
    `Return at most ${TARGET_COUNT} suggestions as a JSON array matching the provided schema.`,
    "Each 'reason' must be a single concise sentence tying the pick to their taste.",
    "Do not recommend any title already present in the history below.",
    "",
    "Watch history (JSON):",
    JSON.stringify(ratings),
  ].join("\n");
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

// Drop-invalid-but-keep-valid: malformed entries are skipped, not fatal; a
// completely unparseable body yields [] (the caller treats zero valid entries
// as a failure). responseSchema makes malformed output rare, not impossible.
export function parseSuggestions(text: string): RawSuggestion[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: RawSuggestion[] = [];
  for (const item of parsed) {
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

    const body = {
      contents: [{ role: "user", parts: [{ text: buildPrompt(req.history) }] }],
      generationConfig: {
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
        temperature: 0.7,
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
      // generic 502 hides. Never logs the key. (A retired model id here is
      // exactly what this once masked.)
      const errorBody = await res.text().catch(() => "<unreadable>");
      console.error(`[recommend] Gemini non-200 status=${res.status} body=${errorBody.slice(0, 1200)}`);
      throw new RecommendationError(`Gemini returned ${res.status}`);
    }

    const data = await res.json().catch(() => null);
    const text = extractText(data);
    if (text == null) throw new RecommendationError("Gemini response had no text part");

    const suggestions = parseSuggestions(text);
    if (suggestions.length === 0) throw new RecommendationError("Gemini returned no valid suggestions");
    return suggestions;
  }
}
