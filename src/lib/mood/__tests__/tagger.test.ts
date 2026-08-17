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

  it("names all eleven moods with their definitions", () => {
    const prompt = buildTagPrompt(batch);
    for (const label of MOOD_LABELS) expect(prompt).toContain(label);
    expect(MOOD_LABELS).toHaveLength(11);
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
    expect(prompt).toContain("Parasite");
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
        { index: 0, title: "Parasite", moods: ["Tense & gripping", "Dark & heavy"] },
        { index: 1, title: "Primer", moods: ["Conceptual", "Thoughtful"] },
      ],
      batch,
    );
    expect(out).toEqual([
      { index: 0, moods: ["Tense & gripping", "Dark & heavy"] },
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
      [{ index: 0, title: "Parasite", moods: ["Tense & gripping", "Melancholy", "Vibes"] }],
      batch,
    );
    expect(out).toEqual([{ index: 0, moods: ["Tense & gripping"] }]);
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

    await tagTitles(Array.from({ length: 45 }, (_, i) => `id${i}`));

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

    await tagTitles(Array.from({ length: 20 }, (_, i) => `id${i}`));
    expect(generateJson).toHaveBeenCalledTimes(1);
  });

  it("numbers each batch from zero, so indices are batch-local", async () => {
    mock(prisma.title.findMany).mockResolvedValue(
      Array.from({ length: 25 }, (_, i) => row(i)),
    );
    mock(generateJson).mockResolvedValue([]);

    await tagTitles(Array.from({ length: 25 }, (_, i) => `id${i}`));

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

    await tagTitles(["id0"]);

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

    const result = await tagTitles(["id0"]);

    const arg = mock(prisma.title.update).mock.calls[0][0];
    expect(arg.where).toEqual({ id: "id0" });
    expect(arg.data.moods).toEqual(["Dark & heavy"]);
    expect(arg.data.moodsTaggedAt).toBeInstanceOf(Date);
    expect(result.tagged).toBe(1);
  });

  it("still stamps moodsTaggedAt when a title matches no mood, so it is never retried", async () => {
    mock(prisma.title.findMany).mockResolvedValue([row(0, { title: "Parasite" })]);
    mock(generateJson).mockResolvedValue([{ index: 0, title: "Parasite", moods: [] }]);

    await tagTitles(["id0"]);

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

    const result = await tagTitles(Array.from({ length: 25 }, (_, i) => `id${i}`));

    expect(generateJson).toHaveBeenCalledTimes(2);
    expect(result.failed).toBe(20);
    expect(result.tagged).toBe(1);
    // Only the surviving batch's title was written.
    expect(mock(prisma.title.update).mock.calls).toHaveLength(1);
    expect(mock(prisma.title.update).mock.calls[0][0].where).toEqual({ id: "id20" });
  });

  it("stops immediately on a rate limit instead of burning the remaining batches", async () => {
    mock(prisma.title.findMany).mockResolvedValue(
      Array.from({ length: 60 }, (_, i) => row(i)),
    );
    mock(generateJson).mockRejectedValue(new GeminiError("cap", "rate_limit"));

    await expect(tagTitles(Array.from({ length: 60 }, (_, i) => `id${i}`))).rejects.toMatchObject({
      kind: "rate_limit",
    });
    expect(generateJson).toHaveBeenCalledTimes(1);
  });

  it("reports progress per request so a caller can show quota use", async () => {
    mock(prisma.title.findMany).mockResolvedValue(
      Array.from({ length: 45 }, (_, i) => row(i)),
    );
    mock(generateJson).mockResolvedValue([]);
    const seen: Array<{ requestNumber: number; totalRequests: number }> = [];

    await tagTitles(
      Array.from({ length: 45 }, (_, i) => `id${i}`),
      { onRequest: (info) => seen.push(info) },
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
