import { prisma } from "@/lib/prisma";
import { Prisma, type RecommendationSet } from "@prisma/client";
import type { ResolvedSuggestion } from "@/lib/recommend/types";

// The most recently generated set, or null if none has ever been generated.
// The screen and GET /api/recommendations read this; opening the screen never
// writes.
export function getLatestRecommendationSet(): Promise<RecommendationSet | null> {
  return prisma.recommendationSet.findFirst({ orderBy: { generatedAt: "desc" } });
}

// Each generation inserts a new row (manual refresh only); readers always take
// the latest. Older rows are harmless; a prune-to-last-N is a later addition.
export function saveRecommendationSet(input: {
  suggestions: ResolvedSuggestion[];
  model: string;
  sourceCount: number;
}): Promise<RecommendationSet> {
  return prisma.recommendationSet.create({
    data: {
      suggestions: input.suggestions as unknown as Prisma.InputJsonValue,
      model: input.model,
      sourceCount: input.sourceCount,
    },
  });
}
