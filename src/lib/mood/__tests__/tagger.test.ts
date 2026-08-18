import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    title: {
      findMany: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}));
vi.mock("@/lib/gemini/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/gemini/client")>();
  return { ...actual, generateJson: vi.fn() };
});

import type { Mock } from "vitest";
import { prisma } from "@/lib/prisma";
import { generateJson, GeminiError } from "@/lib/gemini/client";
import { MOOD_LABELS } from "@/lib/moods";
import {
  TAG_BATCH_SIZE,
  OVERVIEW_MAX_CHARS,
  INTER_REQUEST_DELAY_MS,
  buildTagPrompt,
  parseMoodTaggings,
  truncateOverview,
  tagTitles,
  tagIfUntagged,
  type TaggableTitle,
} from "@/lib/mood/tagger";

// Mock accessors go through one typed cast rather than an untyped one at every
// call site, so this file adds no new lint violations.
const mock = (fn: unknown) => fn as Mock;

/** The prompt string from each generateJson call, in order. */
const promptsSent = (): string[] =>
  mock(generateJson).mock.calls.map((args) => (args[0] as { prompt: string }).prompt);

function taggable(overrides: Partial<TaggableTitle> & { index: number }): TaggableTitle {
  return {
    title: `Film ${overrides.index}`,
    year: 2000 + overrides.index,
    mediaType: "MOVIE",
    genres: ["Drama"],
    overview: `Overview ${overrides.index}`,
    ...overrides,
  };
}

// A DB row as tagTitles loads it, plus the personal fields that must never
// reach the prompt.
function row(i: number, extra: Record<string, unknown> = {}) {
  return {
    id: `id${i}`,
    title: `Film ${i}`,
    year: 2000 + i,
    mediaType: "MOVIE",
    genres: ["Drama"],
    overview: `Overview ${i}`,
    ...extra,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mock(prisma.title.update).mockResolvedValue({});
});

describe("truncateOverview", () => {
  it("leaves a short overview untouched", () => {
    expect(truncateOverview("A short one.")).toBe("A short one.");
  });

  it("truncates an overlong overview at a word boundary", () => {
    const long = "word ".repeat(200).trim();
    const out = truncateOverview(long)!;
    expect(out.length).toBeLessThanOrEqual(OVERVIEW_MAX_CHARS);
    // Cut at a boundary, so no half-word at the end.
    expect(out.endsWith("word")).toBe(true);
  });

  it("handles null", () => {
    expect(truncateOverview(null)).toBeNull();
  });
});

describe("buildTagPrompt", () => {
  const batch = [taggable({ index: 0 }), taggable({ index: 1 })];

  it("names all twelve moods with their definitions", () => {
    const prompt = buildTagPrompt(batch);
    for (const label of MOOD_LABELS) expect(prompt).toContain(label);
    expect(MOOD_LABELS).toHaveLength(12);
  });

  it("carries the Conceptual operative test and its counter-examples", () => {
    const prompt = buildTagPrompt(batch);
    expect(prompt).toContain("could be described without its premise and still make sense");
    expect(prompt).toContain("Primer");
    expect(prompt).toContain("twisty thriller");
  });

  it("disambiguates Conceptual from Thoughtful and Weird", () => {
    const prompt = buildTagPrompt(batch);
    expect(prompt).toContain("Palm Springs is Conceptual but NOT Thoughtful");
    expect(prompt).toContain("Arrival is Conceptual but NOT Weird");
  });

  it("shows that multi-tagging is correct", () => {
    const prompt = buildTagPrompt(batch);
    expect(prompt).toContain("Perfect Blue");
    expect(prompt).toContain("Hereditary");
  });

  it("separates the two halves of the old Tense & gripping mood", () => {
    // Split because one mood covering both registers matched half the library.
    // Without these lines the tagger double-tags and the split buys nothing.
    const prompt = buildTagPrompt(batch);
    expect(prompt).toContain("Slow-burn dread");
    expect(prompt).toContain("Edge-of-seat");
    expect(prompt).toContain("DIFFERENT APPETITES");
    expect(prompt).toContain("PREFER ONE");
    expect(prompt).toContain("Assigning both by default is WRONG");
    // And no longer offers the mood they replaced.
    expect(prompt).not.toContain("Tense & gripping");
  });

  it("separates Slow-burn dread from Scary, which is horror mechanics", () => {
    const prompt = buildTagPrompt(batch);
    expect(prompt).toContain("MADE TO FRIGHTEN");
    expect(prompt).toContain("carry dread with no horror");
  });

  it("separates Edge-of-seat from Big & thrilling, which is scale", () => {
    const prompt = buildTagPrompt(batch);
    expect(prompt).toContain("Uncut Gems is Edge-of-seat, not Big & thrilling");
  });

  it("sends ONLY the whitelisted fields, never personal data (privacy)", () => {
    // A caller passing a leaky object must still produce a clean prompt: the
    // builder assembles from the whitelist rather than serializing what it got.
    const leaky = {
      ...taggable({ index: 0, title: "Whiplash" }),
      myRating: 9,
      note: "SUPER_SECRET_NOTE",
      pinned: true,
      watchedAt: new Date("2024-01-01"),
      status: "WATCHED",
    } as unknown as TaggableTitle;

    const prompt = buildTagPrompt([leaky]);

    expect(prompt).toContain("Whiplash");
    expect(prompt).toContain("Overview 0");
    expect(prompt).not.toContain("SUPER_SECRET_NOTE");
    expect(prompt).not.toContain("myRating");
    expect(prompt).not.toContain("watchedAt");
    expect(prompt).not.toContain("WATCHED");
  });

  it("truncates overviews inside the prompt", () => {
    const long = taggable({ index: 0, overview: "word ".repeat(300).trim() });
    const prompt = buildTagPrompt([long]);
    // The full overview must not survive into the prompt, only its truncation.
    expect(prompt).not.toContain(long.overview!);
    expect(prompt).toContain(truncateOverview(long.overview)!);
  });
});

describe("parseMoodTaggings", () => {
  const batch = [
    taggable({ index: 0, title: "Parasite" }),
    taggable({ index: 1, title: "Primer" }),
  ];

  it("maps a well-formed response to canonical labels", () => {
    const out = parseMoodTaggings(
      [
        { index: 0, title: "Parasite", moods: ["Edge-of-seat", "Dark & heavy"] },
        { index: 1, title: "Primer", moods: ["Conceptual", "Thoughtful"] },
      ],
      batch,
    );
    expect(out).toEqual([
      { index: 0, moods: ["Edge-of-seat", "Dark & heavy"] },
      { index: 1, moods: ["Conceptual", "Thoughtful"] },
    ]);
  });

  it("drops an entry whose index is out of range, keeping the rest", () => {
    const out = parseMoodTaggings(
      [
        { index: 99, title: "Parasite", moods: ["Weird"] },
        { index: 1, title: "Primer", moods: ["Conceptual"] },
      ],
      batch,
    );
    expect(out).toEqual([{ index: 1, moods: ["Conceptual"] }]);
  });

  it("drops an entry whose echoed title does not match its index (MISALIGNMENT)", () => {
    // The model returned Primer's moods against Parasite's index. Writing this
    // would put "Conceptual" on the wrong film, so the entry must be dropped.
    const out = parseMoodTaggings(
      [{ index: 0, title: "Primer", moods: ["Conceptual"] }],
      batch,
    );
    expect(out).toEqual([]);
  });

  it("drops every entry when the whole response is shifted by one", () => {
    // The classic misalignment: each entry carries the neighbouring film's
    // title. Nothing may be written.
    const out = parseMoodTaggings(
      [
        { index: 0, title: "Primer", moods: ["Conceptual"] },
        { index: 1, title: "Parasite", moods: ["Dark & heavy"] },
      ],
      batch,
    );
    expect(out).toEqual([]);
  });

  it("drops an entry with no echoed title, since it cannot be cross-checked", () => {
    const out = parseMoodTaggings([{ index: 0, moods: ["Weird"] }], batch);
    expect(out).toEqual([]);
  });

  it("accepts a title that differs only in punctuation or case", () => {
    const out = parseMoodTaggings(
      [{ index: 0, title: "parasite!", moods: ["Weird"] }],
      batch,
    );
    expect(out).toEqual([{ index: 0, moods: ["Weird"] }]);
  });

  it("drops an unknown mood individually and keeps the valid ones", () => {
    const out = parseMoodTaggings(
      [{ index: 0, title: "Parasite", moods: ["Edge-of-seat", "Melancholy", "Vibes"] }],
      batch,
    );
    expect(out).toEqual([{ index: 0, moods: ["Edge-of-seat"] }]);
  });

  it("collapses duplicate moods", () => {
    const out = parseMoodTaggings(
      [{ index: 0, title: "Parasite", moods: ["Weird", "Weird", "Scary"] }],
      batch,
    );
    expect(out).toEqual([{ index: 0, moods: ["Weird", "Scary"] }]);
  });

  it("treats zero valid moods as a legitimate empty tagging, not a drop", () => {
    const out = parseMoodTaggings(
      [{ index: 0, title: "Parasite", moods: [] }],
      batch,
    );
    expect(out).toEqual([{ index: 0, moods: [] }]);
  });

  it("treats an all-invalid mood list as a legitimate empty tagging", () => {
    const out = parseMoodTaggings(
      [{ index: 0, title: "Parasite", moods: ["Nonsense"] }],
      batch,
    );
    expect(out).toEqual([{ index: 0, moods: [] }]);
  });

  it("omits titles the model never mentioned, so they stay untagged", () => {
    const out = parseMoodTaggings(
      [{ index: 0, title: "Parasite", moods: ["Weird"] }],
      batch,
    );
    expect(out.map((t) => t.index)).toEqual([0]);
  });

  it("skips malformed entries without discarding the batch", () => {
    const out = parseMoodTaggings(
      [
        null,
        "nonsense",
        { index: "0", title: "Parasite", moods: ["Weird"] },
        { index: 0, title: "Parasite", moods: "not an array" },
        { index: 1, title: "Primer", moods: ["Conceptual"] },
      ],
      batch,
    );
    expect(out).toEqual([{ index: 1, moods: ["Conceptual"] }]);
  });

  it("throws when the response is not an array", () => {
    expect(() => parseMoodTaggings({ index: 0 }, batch)).toThrow();
  });
});

describe("tagTitles", () => {
  it("splits 45 titles into batches of 20, 20 and 5", async () => {
    mock(prisma.title.findMany).mockResolvedValue(
      Array.from({ length: 45 }, (_, i) => row(i)),
    );
    mock(generateJson).mockResolvedValue([]);

    await tagTitles(Array.from({ length: 45 }, (_, i) => `id${i}`), { delayMs: 0 });

    expect(generateJson).toHaveBeenCalledTimes(3);
    const sizes = promptsSent().map((p) => (p.match(/"index":/g) ?? []).length);
    expect(sizes).toEqual([20, 20, 5]);
    expect(TAG_BATCH_SIZE).toBe(20);
  });

  it("sends exactly one request for a full single batch", async () => {
    mock(prisma.title.findMany).mockResolvedValue(
      Array.from({ length: 20 }, (_, i) => row(i)),
    );
    mock(generateJson).mockResolvedValue([]);

    await tagTitles(Array.from({ length: 20 }, (_, i) => `id${i}`), { delayMs: 0 });
    expect(generateJson).toHaveBeenCalledTimes(1);
  });

  it("numbers each batch from zero, so indices are batch-local", async () => {
    mock(prisma.title.findMany).mockResolvedValue(
      Array.from({ length: 25 }, (_, i) => row(i)),
    );
    mock(generateJson).mockResolvedValue([]);

    await tagTitles(Array.from({ length: 25 }, (_, i) => `id${i}`), { delayMs: 0 });

    // Compact JSON, deliberately: the payload is spent tokens, and this runs
    // against a 20-request daily budget.
    const secondPrompt = promptsSent()[1];
    expect(secondPrompt).toContain('"index":0');
    expect(secondPrompt).toContain("Film 20");
    // ...and the 21st title is the batch's index 0, not index 20.
    expect(secondPrompt).not.toContain('"index":20');
  });

  it("loads rows with an explicit select, so personal columns never enter memory", async () => {
    mock(prisma.title.findMany).mockResolvedValue([row(0)]);
    mock(generateJson).mockResolvedValue([]);

    await tagTitles(["id0"], { delayMs: 0 });

    const arg = mock(prisma.title.findMany).mock.calls[0][0];
    expect(arg.select).toBeDefined();
    for (const forbidden of ["myRating", "note", "watchedAt", "pinned"]) {
      expect(arg.select[forbidden]).toBeUndefined();
    }
  });

  it("writes moods and moodsTaggedAt for a tagged title", async () => {
    mock(prisma.title.findMany).mockResolvedValue([row(0, { title: "Parasite" })]);
    mock(generateJson).mockResolvedValue([
      { index: 0, title: "Parasite", moods: ["Dark & heavy"] },
    ]);

    const result = await tagTitles(["id0"], { delayMs: 0 });

    const arg = mock(prisma.title.update).mock.calls[0][0];
    expect(arg.where).toEqual({ id: "id0" });
    expect(arg.data.moods).toEqual(["Dark & heavy"]);
    expect(arg.data.moodsTaggedAt).toBeInstanceOf(Date);
    expect(result.tagged).toBe(1);
  });

  it("still stamps moodsTaggedAt when a title matches no mood, so it is never retried", async () => {
    mock(prisma.title.findMany).mockResolvedValue([row(0, { title: "Parasite" })]);
    mock(generateJson).mockResolvedValue([{ index: 0, title: "Parasite", moods: [] }]);

    await tagTitles(["id0"], { delayMs: 0 });

    const arg = mock(prisma.title.update).mock.calls[0][0];
    expect(arg.data.moods).toEqual([]);
    expect(arg.data.moodsTaggedAt).toBeInstanceOf(Date);
  });

  it("leaves a failed batch untouched and continues with the next", async () => {
    mock(prisma.title.findMany).mockResolvedValue(
      Array.from({ length: 25 }, (_, i) => row(i)),
    );
    mock(generateJson)
      .mockRejectedValueOnce(new GeminiError("boom", "failure"))
      .mockResolvedValueOnce([{ index: 0, title: "Film 20", moods: ["Weird"] }]);

    const result = await tagTitles(Array.from({ length: 25 }, (_, i) => `id${i}`), { delayMs: 0 });

    expect(generateJson).toHaveBeenCalledTimes(2);
    expect(result.failed).toBe(20);
    expect(result.tagged).toBe(1);
    // Only the surviving batch's title was written.
    expect(mock(prisma.title.update).mock.calls).toHaveLength(1);
    expect(mock(prisma.title.update).mock.calls[0][0].where).toEqual({ id: "id20" });
  });

  it("stops after 3 consecutive batch failures instead of burning the whole budget", async () => {
    // The 2026-08-17 failure: an unavailable model 503'd every call and the run
    // spent 17 of 20 daily requests learning that one batch at a time.
    mock(prisma.title.findMany).mockResolvedValue(
      Array.from({ length: 200 }, (_, i) => row(i)),
    );
    mock(generateJson).mockRejectedValue(new GeminiError("high demand", "failure"));

    const result = await tagTitles(
      Array.from({ length: 200 }, (_, i) => `id${i}`),
      { delayMs: 0 },
    );

    expect(generateJson).toHaveBeenCalledTimes(3);
    expect(result.stoppedReason).toBe("consecutive_failures");
    expect(result.tagged).toBe(0);
  });

  it("resets the failure counter after a success, so intermittent errors do not abort", async () => {
    mock(prisma.title.findMany).mockResolvedValue(
      Array.from({ length: 100 }, (_, i) => row(i)),
    );
    mock(generateJson)
      .mockRejectedValueOnce(new GeminiError("blip", "failure"))
      .mockRejectedValueOnce(new GeminiError("blip", "failure"))
      .mockResolvedValueOnce([{ index: 0, title: "Film 40", moods: ["Weird"] }])
      .mockRejectedValueOnce(new GeminiError("blip", "failure"))
      .mockRejectedValueOnce(new GeminiError("blip", "failure"));

    const result = await tagTitles(
      Array.from({ length: 100 }, (_, i) => `id${i}`),
      { delayMs: 0 },
    );

    // All five batches attempted: the success in the middle reset the counter.
    expect(generateJson).toHaveBeenCalledTimes(5);
    expect(result.stoppedReason).toBeUndefined();
    expect(result.tagged).toBe(1);
  });

  it("gives the request far longer than the client's user-facing default", async () => {
    // 20s aborted 4 of 5 batches on 2026-08-17 while one finished in ~18s, and an
    // abort still spends the request. Nothing is waiting on this path.
    mock(prisma.title.findMany).mockResolvedValue([row(0, { title: "Parasite" })]);
    mock(generateJson).mockResolvedValue([{ index: 0, title: "Parasite", moods: ["Weird"] }]);

    await tagTitles(["id0"], { delayMs: 0 });

    const opts = mock(generateJson).mock.calls[0][0] as { timeoutMs?: number };
    expect(opts.timeoutMs).toBeGreaterThanOrEqual(60_000);
  });

  it("reports which model served the run", async () => {
    mock(prisma.title.findMany).mockResolvedValue([row(0, { title: "Parasite" })]);
    mock(generateJson).mockResolvedValue([{ index: 0, title: "Parasite", moods: ["Weird"] }]);

    const result = await tagTitles(["id0"], { delayMs: 0, model: "gemini-3.6-flash" });

    expect(result.model).toBe("gemini-3.6-flash");
    const opts = mock(generateJson).mock.calls[0][0] as { model?: string };
    expect(opts.model).toBe("gemini-3.6-flash");
  });

  it("stops on a rate limit WITHOUT throwing away its counters", async () => {
    // Throwing here discarded tagged/failed/requests, which is why a drained run
    // printed "Tagged 0, failed 0, using 0 request(s)" directly above DB counts
    // proving work had happened.
    mock(prisma.title.findMany).mockResolvedValue(
      Array.from({ length: 60 }, (_, i) => row(i)),
    );
    mock(generateJson)
      .mockImplementationOnce(async (opts: { onAttempt?: () => void }) => {
        opts.onAttempt?.();
        return [{ index: 0, title: "Film 0", moods: ["Weird"] }];
      })
      .mockImplementationOnce(async (opts: { onAttempt?: () => void }) => {
        opts.onAttempt?.();
        throw new GeminiError("cap", "rate_limit");
      });

    const result = await tagTitles(Array.from({ length: 60 }, (_, i) => `id${i}`), { delayMs: 0 });

    expect(result.stoppedReason).toBe("rate_limit");
    // The work it DID do survives into the result.
    expect(result.tagged).toBe(1);
    expect(result.requests).toBe(2);
    expect(result.batches).toBe(2);
    // And it stopped rather than grinding through the third batch.
    expect(generateJson).toHaveBeenCalledTimes(2);
  });

  it("counts REAL requests including retries, not batches", async () => {
    // THE BUG: retries were invisible, so a run believed it had spent 10 of 20
    // when it had actually spent all 20 and then died on a 429.
    mock(prisma.title.findMany).mockResolvedValue(
      Array.from({ length: 40 }, (_, i) => row(i)),
    );
    // Two batches; the client reports 3 attempts for the first, 1 for the second.
    mock(generateJson)
      .mockImplementationOnce(async (opts: { onAttempt?: () => void }) => {
        opts.onAttempt?.();
        opts.onAttempt?.();
        opts.onAttempt?.();
        return [];
      })
      .mockImplementationOnce(async (opts: { onAttempt?: () => void }) => {
        opts.onAttempt?.();
        return [];
      });

    const result = await tagTitles(Array.from({ length: 40 }, (_, i) => `id${i}`), { delayMs: 0 });

    expect(result.batches).toBe(2);
    expect(result.requests).toBe(4);
  });

  it("stops at the request budget before a 429 can happen", async () => {
    mock(prisma.title.findMany).mockResolvedValue(
      Array.from({ length: 200 }, (_, i) => row(i)),
    );
    // Faithful to the client: it makes 1 + retryDelaysMs.length attempts, so the
    // tagger's clamp genuinely bounds spend rather than being ignored here.
    mock(generateJson).mockImplementation(async (opts: { onAttempt?: () => void; retryDelaysMs?: number[] }) => {
      for (let i = 0; i <= (opts.retryDelaysMs?.length ?? 0); i++) opts.onAttempt?.();
      return [];
    });

    const result = await tagTitles(
      Array.from({ length: 200 }, (_, i) => `id${i}`),
      { delayMs: 0, requestBudget: 5 },
    );

    expect(result.stoppedReason).toBe("budget_exhausted");
    // Exactly at the budget, never over: 2 + 2 + 1, the last batch clamped to a
    // single attempt because only one request remained.
    expect(result.requests).toBe(5);
    expect(result.batches).toBe(3);
  });

  it("clamps retries to the remaining budget so the last request is not overshot", async () => {
    mock(prisma.title.findMany).mockResolvedValue(
      Array.from({ length: 40 }, (_, i) => row(i)),
    );
    const seen: number[] = [];
    mock(generateJson).mockImplementation(async (opts: { onAttempt?: () => void; retryDelaysMs?: number[] }) => {
      seen.push(opts.retryDelaysMs?.length ?? -1);
      opts.onAttempt?.();
      return [];
    });

    // Budget of 2: the first batch may retry once (1 spent, 1 left), the second
    // gets no retry allowance at all.
    await tagTitles(Array.from({ length: 40 }, (_, i) => `id${i}`), { delayMs: 0, requestBudget: 2 });

    expect(seen).toEqual([1, 0]);
  });

  it("defaults to a single retry on the quota-limited tier", async () => {
    // Three attempts per batch spends scarce quota on a doomed batch, and 503s
    // are correlated across attempts rather than independent.
    mock(prisma.title.findMany).mockResolvedValue([row(0, { title: "Parasite" })]);
    mock(generateJson).mockImplementation(async (opts: { onAttempt?: () => void }) => {
      opts.onAttempt?.();
      return [{ index: 0, title: "Parasite", moods: ["Weird"] }];
    });

    await tagTitles(["id0"], { delayMs: 0 });

    const opts = mock(generateJson).mock.calls[0][0] as { retryDelaysMs?: number[] };
    expect(opts.retryDelaysMs).toHaveLength(1);
  });

  it("paces requests to stay under the 5-per-minute cap", async () => {
    // The free tier allows 5 requests/minute as well as 20/day, so batches must
    // not fire back to back. Without this the 6th request of a backfill 429s
    // inside the first minute with most of the daily budget still unspent.
    vi.useFakeTimers();
    try {
      mock(prisma.title.findMany).mockResolvedValue(
        Array.from({ length: 25 }, (_, i) => row(i)),
      );
      mock(generateJson).mockResolvedValue([]);

      const promise = tagTitles(Array.from({ length: 25 }, (_, i) => `id${i}`));

      // First request goes immediately; the second must still be waiting.
      await vi.advanceTimersByTimeAsync(0);
      expect(generateJson).toHaveBeenCalledTimes(1);

      // Not yet: one millisecond short of the delay.
      await vi.advanceTimersByTimeAsync(INTER_REQUEST_DELAY_MS - 1);
      expect(generateJson).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(1);
      await promise;
      expect(generateJson).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("does not wait when there is only one request to make", async () => {
    // The add/refresh path tags a single title; pacing must not delay it.
    vi.useFakeTimers();
    try {
      mock(prisma.title.findMany).mockResolvedValue([row(0, { title: "Parasite" })]);
      mock(generateJson).mockResolvedValue([{ index: 0, title: "Parasite", moods: ["Weird"] }]);

      const promise = tagTitles(["id0"]);
      await vi.advanceTimersByTimeAsync(0);

      await expect(promise).resolves.toMatchObject({ tagged: 1, batches: 1 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps the pacing delay above the per-minute limit's requirement", () => {
    // 5 requests/minute means a floor of 12s between requests; the constant must
    // sit above that, or a "small optimisation" silently reintroduces the 429.
    expect(INTER_REQUEST_DELAY_MS).toBeGreaterThanOrEqual(13_000);
  });

  it("reports progress per request so a caller can show quota use", async () => {
    mock(prisma.title.findMany).mockResolvedValue(
      Array.from({ length: 45 }, (_, i) => row(i)),
    );
    mock(generateJson).mockResolvedValue([]);
    const seen: Array<{ requestNumber: number; totalRequests: number }> = [];

    await tagTitles(
      Array.from({ length: 45 }, (_, i) => `id${i}`),
      { onRequest: (info) => seen.push(info), delayMs: 0 },
    );

    expect(seen.map((s) => s.requestNumber)).toEqual([1, 2, 3]);
    expect(seen[0].totalRequests).toBe(3);
  });
});

describe("tagIfUntagged", () => {
  it("makes no Gemini call when the title is already tagged", async () => {
    mock(prisma.title.findUnique).mockResolvedValue({
      id: "id0",
      moodsTaggedAt: new Date("2026-08-01"),
    });

    await tagIfUntagged("id0");

    expect(generateJson).not.toHaveBeenCalled();
    expect(prisma.title.update).not.toHaveBeenCalled();
  });

  it("tags a title that has never been tagged", async () => {
    mock(prisma.title.findUnique).mockResolvedValue({ id: "id0", moodsTaggedAt: null });
    mock(prisma.title.findMany).mockResolvedValue([row(0, { title: "Parasite" })]);
    mock(generateJson).mockResolvedValue([
      { index: 0, title: "Parasite", moods: ["Dark & heavy"] },
    ]);

    await tagIfUntagged("id0");

    expect(generateJson).toHaveBeenCalledTimes(1);
    expect(mock(prisma.title.update).mock.calls[0][0].data.moods).toEqual(["Dark & heavy"]);
  });

  it("does nothing for a missing title", async () => {
    mock(prisma.title.findUnique).mockResolvedValue(null);
    await tagIfUntagged("nope");
    expect(generateJson).not.toHaveBeenCalled();
  });

  it("swallows a Gemini failure, since it runs after the response is sent", async () => {
    mock(prisma.title.findUnique).mockResolvedValue({ id: "id0", moodsTaggedAt: null });
    mock(prisma.title.findMany).mockResolvedValue([row(0)]);
    mock(generateJson).mockRejectedValue(new GeminiError("boom", "failure"));

    await expect(tagIfUntagged("id0")).resolves.toBeUndefined();
  });

  it("swallows a rate limit too, which tagTitles rethrows", async () => {
    mock(prisma.title.findUnique).mockResolvedValue({ id: "id0", moodsTaggedAt: null });
    mock(prisma.title.findMany).mockResolvedValue([row(0)]);
    mock(generateJson).mockRejectedValue(new GeminiError("cap", "rate_limit"));

    await expect(tagIfUntagged("id0")).resolves.toBeUndefined();
  });
});
