import { getTitleDetails } from "@/lib/tmdb";
import { getScoresByImdbId } from "@/lib/omdb";
import type { TmdbDetails, MediaKind } from "@/lib/types";
import type { OmdbScores } from "@/lib/omdb";

export type MergedTitle = TmdbDetails & OmdbScores;

const NO_SCORES: OmdbScores = { imdbScore: null, rtScore: null, metacriticScore: null };

export async function fetchMergedTitle(tmdbId: number, mediaType: MediaKind): Promise<MergedTitle> {
  const details = await getTitleDetails(tmdbId, mediaType);
  const scores = details.imdbId ? await getScoresByImdbId(details.imdbId) : NO_SCORES;
  return { ...details, ...scores };
}
