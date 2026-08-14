import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateJson, GeminiError, GEMINI_MODEL, MAX_OUTPUT_TOKENS } from "@/lib/gemini/client";

// Ported from the removed src/lib/recommend/__tests__/gemini.test.ts, which was
// the only coverage on this plumbing. The cases that belonged to the transport
// (non-200, 429, malformed JSON, missing text part, abort/timeout, header auth,
// JSON mode) live here now; the suggestion-parsing cases went with the feature.

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

const SCHEMA = { type: "array", items: { type: "object" } } as const;

function call(overrides: Partial<Parameters<typeof generateJson>[0]> = {}) {
  return generateJson({ prompt: "p", responseSchema: SCHEMA, logPrefix: "[test]", ...overrides });
}

beforeEach(() => {
  process.env.GEMINI_API_KEY = "test-key";
  // The non-200 and breadcrumb paths log deliberately; keep the test output
  // readable while still exercising them.
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("generateJson", () => {
  it("returns the parsed JSON from candidates[0].content.parts[0].text", async () => {
    stubFetchJson(envelope(JSON.stringify([{ ok: true }])));
    await expect(call()).resolves.toEqual([{ ok: true }]);
  });

  it("returns a well-formed empty array as-is (not an error)", async () => {
    stubFetchJson(envelope("[]"));
    await expect(call()).resolves.toEqual([]);
  });

  it("returns a non-array payload when expectArray is not set", async () => {
    stubFetchJson(envelope(JSON.stringify({ title: "X" })));
    await expect(call()).resolves.toEqual({ title: "X" });
  });

  it("throws when expectArray is set and the payload is not an array", async () => {
    stubFetchJson(envelope(JSON.stringify({ title: "X" })));
    await expect(call({ expectArray: true })).rejects.toBeInstanceOf(GeminiError);
  });

  it("posts to the model endpoint, authenticates by header, and requests JSON mode", async () => {
    const fetchMock = stubFetchJson(envelope("[]"));
    await call({ temperature: 0.2, maxOutputTokens: 4096 });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain(`models/${GEMINI_MODEL}:generateContent`);
    // The key goes in the header, never the query string.
    const headers = init.headers as Record<string, string>;
    expect(headers["x-goog-api-key"]).toBe("test-key");
    expect(url).not.toContain("test-key");

    const parsed = JSON.parse(String(init.body));
    expect(parsed.generationConfig.responseMimeType).toBe("application/json");
    expect(parsed.generationConfig.responseSchema).toEqual(SCHEMA);
    expect(parsed.generationConfig.temperature).toBe(0.2);
    expect(parsed.generationConfig.maxOutputTokens).toBe(4096);
    expect(parsed.contents[0].parts[0].text).toBe("p");
  });

  it("defaults maxOutputTokens to 8192 and omits temperature when unset", async () => {
    const fetchMock = stubFetchJson(envelope("[]"));
    await call();

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const { generationConfig } = JSON.parse(String(init.body));
    expect(generationConfig.maxOutputTokens).toBe(MAX_OUTPUT_TOKENS);
    expect(generationConfig.maxOutputTokens).toBe(8192);
    expect(generationConfig).not.toHaveProperty("temperature");
  });

  it("throws on a non-200 response", async () => {
    stubFetchJson({}, { ok: false, status: 500 });
    await expect(call()).rejects.toBeInstanceOf(GeminiError);
  });

  it("tags a 429 as a rate_limit error", async () => {
    stubFetchJson({}, { ok: false, status: 429 });
    await expect(call()).rejects.toMatchObject({ kind: "rate_limit" });
  });

  it("throws on malformed / truncated JSON", async () => {
    stubFetchJson(envelope('[{"title":"Cut off mid-array'));
    await expect(call()).rejects.toBeInstanceOf(GeminiError);
  });

  it("throws without a network call when GEMINI_API_KEY is unset", async () => {
    delete process.env.GEMINI_API_KEY;
    const fetchMock = stubFetchJson(envelope("[]"));
    await expect(call()).rejects.toBeInstanceOf(GeminiError);
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
    const promise = call();
    const assertion = expect(promise).rejects.toMatchObject({ kind: "timeout" });
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
  });

  it("honours a custom timeoutMs", async () => {
    vi.useFakeTimers();
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
    const promise = call({ timeoutMs: 5_000 });
    const assertion = expect(promise).rejects.toThrow(/timed out/);
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
  });
});

// A renamed or restructured response envelope must degrade to a thrown
// GeminiError, never a TypeError from reaching through a missing hop. This is
// what the guarded accessors buy, so each hop is covered explicitly.
describe("generateJson response-shape guards", () => {
  const shapes: Array<[string, unknown]> = [
    ["null body", null],
    ["not an object", "a string"],
    ["no candidates key", {}],
    ["empty candidates", { candidates: [] }],
    ["candidates not an array", { candidates: {} }],
    ["no content", { candidates: [{}] }],
    ["no parts", { candidates: [{ content: {} }] }],
    ["empty parts", { candidates: [{ content: { parts: [] } }] }],
    ["part without text", { candidates: [{ content: { parts: [{}] } }] }],
    ["text is not a string", { candidates: [{ content: { parts: [{ text: 42 }] } }] }],
  ];

  for (const [label, payload] of shapes) {
    it(`throws GeminiError, not TypeError, on ${label}`, async () => {
      stubFetchJson(payload);
      await expect(call()).rejects.toBeInstanceOf(GeminiError);
    });
  }

  it("still throws GeminiError when the usage breadcrumb itself is missing", async () => {
    // summarizeUsage/getFinishReason run on the failure path; a response with
    // neither must not blow up while logging.
    stubFetchJson({ candidates: [{ content: { parts: [] } }] });
    await expect(call()).rejects.toThrow(/no text part/);
  });
});
