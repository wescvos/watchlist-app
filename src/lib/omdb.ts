import { env } from "@/lib/env";

export interface OmdbScores {
  imdbScore: string | null;
  rtScore: string | null;
  metacriticScore: string | null;
}

const EMPTY: OmdbScores = { imdbScore: null, rtScore: null, metacriticScore: null };

// The slice of OMDb's JSON this module reads. OMDb reports "N/A" rather than
// omitting a missing score, which the mapping below filters out.
interface OmdbResponse {
  Response?: string;
  Ratings?: { Source: string; Value: string }[];
  imdbRating?: string;
  Metascore?: string;
}

export async function getScoresByImdbId(imdbId: string): Promise<OmdbScores> {
  const url = new URL("https://www.omdbapi.com/");
  url.searchParams.set("apikey", env.omdbKey);
  url.searchParams.set("i", imdbId);

  const res = await fetch(url.toString());
  if (!res.ok) return EMPTY;
  let data: OmdbResponse;
  try {
    data = await res.json();
  } catch {
    return EMPTY;
  }
  if (data.Response !== "True") return EMPTY;

  const ratings: { Source: string; Value: string }[] = data.Ratings ?? [];
  const rt = ratings.find((r) => r.Source === "Rotten Tomatoes")?.Value ?? null;

  return {
    imdbScore: data.imdbRating && data.imdbRating !== "N/A" ? data.imdbRating : null,
    rtScore: rt && rt !== "N/A" ? rt : null,
    metacriticScore: data.Metascore && data.Metascore !== "N/A" ? data.Metascore : null,
  };
}
