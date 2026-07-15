import { env } from "@/lib/env";

export interface OmdbScores {
  imdbScore: string | null;
  rtScore: string | null;
  metacriticScore: string | null;
}

const EMPTY: OmdbScores = { imdbScore: null, rtScore: null, metacriticScore: null };

export async function getScoresByImdbId(imdbId: string): Promise<OmdbScores> {
  const url = new URL("https://www.omdbapi.com/");
  url.searchParams.set("apikey", env.omdbKey);
  url.searchParams.set("i", imdbId);

  const res = await fetch(url.toString());
  if (!res.ok) return EMPTY;
  const data = await res.json();
  if (data.Response !== "True") return EMPTY;

  const ratings: { Source: string; Value: string }[] = data.Ratings ?? [];
  const rt = ratings.find((r) => r.Source === "Rotten Tomatoes")?.Value ?? null;

  return {
    imdbScore: data.imdbRating && data.imdbRating !== "N/A" ? data.imdbRating : null,
    rtScore: rt,
    metacriticScore: data.Metascore && data.Metascore !== "N/A" ? data.Metascore : null,
  };
}
