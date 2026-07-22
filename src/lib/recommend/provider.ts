import type { RecommendationProvider } from "./types";
import { GeminiRecommendationProvider } from "./gemini";

// Single swap point. Swapping LLMs later (or wrapping one for Option C) means
// returning a different implementation here; no caller changes.
export function getProvider(): RecommendationProvider {
  return new GeminiRecommendationProvider();
}
