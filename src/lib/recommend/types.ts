import type { MediaKind } from "@/lib/types";

// One recommendation after TMDb resolution: it carries a real tmdbId so a card
// can link straight into the existing preview/add flow. This is exactly the
// shape stored in RecommendationSet.suggestions and rendered by the screen.
//
// Defined here up front so the cache repository (Task 1) and the recommend
// service (Task 2) share one type. The service's remaining types (RatedTitle,
// RawSuggestion, RecommendationRequest, RecommendationProvider) are added in
// Task 2.
export interface ResolvedSuggestion {
  tmdbId: number;
  mediaType: MediaKind;
  title: string;
  year: number | null;
  posterUrl: string | null;
  reason: string;
}
