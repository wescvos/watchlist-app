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

// One watched title's rating signal. This is the ONLY shape that leaves the
// app to the LLM (privacy whitelist): title, year, mediaType, myRating. Never
// a whole Title row, never notes/passcode/credentials.
export interface RatedTitle {
  title: string;
  year: number | null;
  mediaType: MediaKind;
  myRating: number | null;
}

// One suggestion exactly as the model returns it, before TMDb resolution
// attaches a real tmdbId/poster. See the design spec, section 5.
export interface RawSuggestion {
  title: string;
  year: number | null;
  mediaType: MediaKind;
  reason: string;
}

export interface RecommendationRequest {
  history: RatedTitle[];
  // Option C (deferred): a grounded pool of real TMDb candidates the model
  // ranks/explains instead of inventing. When present, the Gemini prompt
  // includes it and the model can return the pool's tmdbIds directly. v1
  // leaves this undefined; adding it later changes nothing else here.
  // candidatePool?: CandidateTitle[];
}

// The LLM seam: rating history in, raw suggestions out. Knows nothing about the
// DB, TMDb, caching, or HTTP. Swapping providers = a new implementation behind
// getProvider() (src/lib/recommend/provider.ts); no caller changes.
export interface RecommendationProvider {
  readonly model: string;
  recommend(req: RecommendationRequest): Promise<RawSuggestion[]>;
}
