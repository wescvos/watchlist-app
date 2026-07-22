import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  GeminiRecommendationProvider,
  RecommendationError,
  parseSuggestions,
  GEMINI_MODEL,
} from "@/lib/recommend/gemini";
import type { RatedTitle } from "@/lib/recommend/types";

// Minimal Gemini generateContent envelope with a given text part.
function envelope(text: string) {
  return { candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }] };
}

// Stub fetch to resolve with a JSON payload. Returns the mock so tests can
// inspect the request (url, headers, body).
function stubFetchJson(payload: unknown, opts: { ok?: boolean; status?: number } = {}) {
  const res = {
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    json: async () => payload,
    text: async () => (typeof payload === "string" ? payload : JSON.stringify(payload)),
  } as unknown as Response;
  const fn = vi.fn(async () => res);
  vi.stubGlobal("fetch", fn);
  return fn;
}

const HISTORY: RatedTitle[] = [
  { title: "Whiplash", year: 2014, mediaType: "MOVIE", myRating: 9 },
  { title: "Severance", year: 2022, mediaType: "TV", myRating: 8 },
];

const provider = new GeminiRecommendationProvider();

beforeEach(() => {
  process.env.GEMINI_API_KEY = "test-key";
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("parseSuggestions", () => {
  it("maps a valid JSON array to RawSuggestion[]", () => {
    const out = parseSuggestions(
      JSON.stringify([{ title: "Sicario", year: 2015, mediaType: "MOVIE", reason: "Tense, precise thriller." }]),
    );
    expect(out).toEqual([{ title: "Sicario", year: 2015, mediaType: "MOVIE", reason: "Tense, precise thriller." }]);
  });

  it("keeps only valid entries, dropping malformed ones", () => {
    const out = parseSuggestions(
      JSON.stringify([
        { title: "Good", year: 2000, mediaType: "MOVIE", reason: "ok" },
        { title: "", mediaType: "MOVIE", reason: "empty title dropped" },
        { title: "Bad type", mediaType: "PODCAST", reason: "bad mediaType dropped" },
        { title: "No reason", mediaType: "TV" },
        { title: "No media", year: 1999, reason: "missing mediaType dropped" },
        { title: "Also good", mediaType: "TV", reason: "kept, year coerced to null" },
      ]),
    );
    expect(out).toEqual([
      { title: "Good", year: 2000, mediaType: "MOVIE", reason: "ok" },
      { title: "Also good", year: null, mediaType: "TV", reason: "kept, year coerced to null" },
    ]);
  });

  it("returns [] for unparseable JSON", () => {
    expect(parseSuggestions("this is not json")).toEqual([]);
  });

  it("returns [] when the payload is not an array", () => {
    expect(parseSuggestions(JSON.stringify({ title: "X" }))).toEqual([]);
  });

  it("caps an overlong reason", () => {
    const long = "x".repeat(500);
    const [s] = parseSuggestions(JSON.stringify([{ title: "T", mediaType: "MOVIE", reason: long }]));
    expect(s.reason.length).toBe(200);
  });
});

describe("GeminiRecommendationProvider.recommend", () => {
  it("returns parsed suggestions on a valid response", async () => {
    stubFetchJson(
      envelope(JSON.stringify([{ title: "Sicario", year: 2015, mediaType: "MOVIE", reason: "Tense thriller." }])),
    );
    const out = await provider.recommend({ history: HISTORY });
    expect(out).toEqual([{ title: "Sicario", year: 2015, mediaType: "MOVIE", reason: "Tense thriller." }]);
  });

  it("keeps valid entries when the model mixes in malformed ones", async () => {
    stubFetchJson(
      envelope(
        JSON.stringify([
          { title: "Kept", mediaType: "MOVIE", reason: "good" },
          { title: "", mediaType: "MOVIE", reason: "dropped" },
        ]),
      ),
    );
    const out = await provider.recommend({ history: HISTORY });
    expect(out).toEqual([{ title: "Kept", year: null, mediaType: "MOVIE", reason: "good" }]);
  });

  it("requests JSON mode and sends ONLY the whitelisted fields (privacy)", async () => {
    process.env.APP_PASSCODE = "SUPER_SECRET_PASSCODE";
    process.env.DATABASE_URL = "postgresql://user:pw@host/db";
    const fetchMock = stubFetchJson(
      envelope(JSON.stringify([{ title: "X", mediaType: "MOVIE", reason: "r" }])),
    );
    await provider.recommend({ history: HISTORY });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain(`models/${GEMINI_MODEL}:generateContent`);
    const headers = init.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("test-key");
    const body = String(init.body);
    const parsed = JSON.parse(body);
    expect(parsed.generationConfig.responseMimeType).toBe("application/json");
    // Whitelisted signal is present…
    expect(body).toContain("Whiplash");
    expect(body).toContain("9");
    // …and no secret ever leaks into the prompt.
    expect(body).not.toContain("SUPER_SECRET_PASSCODE");
    expect(body).not.toContain("postgresql://");
  });

  it("throws on a non-200 response", async () => {
    stubFetchJson({}, { ok: false, status: 500 });
    await expect(provider.recommend({ history: HISTORY })).rejects.toBeInstanceOf(RecommendationError);
  });

  it("throws when the response has no text part", async () => {
    stubFetchJson({ candidates: [] });
    await expect(provider.recommend({ history: HISTORY })).rejects.toBeInstanceOf(RecommendationError);
  });

  it("throws when the model returns zero valid suggestions", async () => {
    stubFetchJson(envelope(JSON.stringify([{ title: "", mediaType: "MOVIE", reason: "" }])));
    await expect(provider.recommend({ history: HISTORY })).rejects.toBeInstanceOf(RecommendationError);
  });

  it("throws without a network call when GEMINI_API_KEY is unset", async () => {
    delete process.env.GEMINI_API_KEY;
    const fetchMock = stubFetchJson(envelope("[]"));
    await expect(provider.recommend({ history: HISTORY })).rejects.toBeInstanceOf(RecommendationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("aborts and throws a timeout error when Gemini hangs past the deadline", async () => {
    vi.useFakeTimers();
    // fetch that only rejects once its abort signal fires.
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(Object.assign(new Error("aborted"), { name: "AbortError" })),
            );
          }),
      ),
    );
    const promise = provider.recommend({ history: HISTORY });
    const assertion = expect(promise).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
  });
});
