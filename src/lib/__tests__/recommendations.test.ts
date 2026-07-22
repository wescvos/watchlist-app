import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    recommendationSet: {
      findFirst: vi.fn(),
      create: vi.fn(),
    },
  },
}));

import { prisma } from "@/lib/prisma";
import { getLatestRecommendationSet, saveRecommendationSet } from "@/lib/recommendations";
import type { ResolvedSuggestion } from "@/lib/recommend/types";
import type { RecommendationSet } from "@prisma/client";

const findFirst = vi.mocked(prisma.recommendationSet.findFirst);
const create = vi.mocked(prisma.recommendationSet.create);

function row(overrides: Partial<RecommendationSet> = {}): RecommendationSet {
  return { id: "r1", suggestions: [], model: "m", sourceCount: 0, generatedAt: new Date(), ...overrides };
}

beforeEach(() => vi.clearAllMocks());

describe("getLatestRecommendationSet", () => {
  it("returns null when nothing has been generated", async () => {
    findFirst.mockResolvedValue(null);
    expect(await getLatestRecommendationSet()).toBeNull();
  });

  it("returns the most recent row, ordered by generatedAt desc", async () => {
    const latest = row({ sourceCount: 3 });
    findFirst.mockResolvedValue(latest);
    const out = await getLatestRecommendationSet();
    expect(out).toBe(latest);
    expect(findFirst.mock.calls[0][0]?.orderBy).toEqual({ generatedAt: "desc" });
  });
});

describe("saveRecommendationSet", () => {
  it("inserts a new row with the given suggestions, model, and sourceCount", async () => {
    const suggestions: ResolvedSuggestion[] = [
      { tmdbId: 1, mediaType: "MOVIE", title: "X", year: 2020, posterUrl: null, reason: "why" },
    ];
    create.mockResolvedValue(row({ id: "new" }));
    await saveRecommendationSet({ suggestions, model: "gemini-x", sourceCount: 5 });
    const data = create.mock.calls[0][0].data;
    expect(data.model).toBe("gemini-x");
    expect(data.sourceCount).toBe(5);
    expect(data.suggestions).toEqual(suggestions);
  });
});
