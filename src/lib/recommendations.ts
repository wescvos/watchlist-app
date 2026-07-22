import { prisma } from "@/lib/prisma";
import { Prisma, type RecommendationSet } from "@prisma/client";
import type { ResolvedSuggestion } from "@/lib/recommend/types";
import type { MediaKind } from "@/lib/types";

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

// Records a permanent "not interested" dismissal. Upsert so a repeat tap is a
// harmless no-op; never deletes anything. dismissedAt is provenance only —
// nothing reads it for filtering.
export async function dismissTitle(tmdbId: number, mediaType: MediaKind): Promise<void> {
  await prisma.dismissedTitle.upsert({
    where: { tmdbId_mediaType: { tmdbId, mediaType } },
    update: {},
    create: { tmdbId, mediaType },
  });
}

// Dismissed titles as "mediaType:tmdbId" keys, for the resolution exclusion
// filter (alongside on-list titles). The table is tiny, so one read per
// generation is cheap.
export async function getDismissedKeySet(): Promise<Set<string>> {
  const rows = await prisma.dismissedTitle.findMany({ select: { tmdbId: true, mediaType: true } });
  return new Set(rows.map((r) => `${r.mediaType}:${r.tmdbId}`));
}
