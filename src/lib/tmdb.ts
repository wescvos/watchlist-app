import { env } from "@/lib/env";
import type { SearchResult, TmdbDetails, MediaKind, CastMember, WatchProvider } from "@/lib/types";

const BASE = "https://api.themoviedb.org/3";
const IMG = "https://image.tmdb.org/t/p/w500";
const PROFILE_IMG = "https://image.tmdb.org/t/p/w185";
const PROVIDER_LOGO_IMG = "https://image.tmdb.org/t/p/w92";
const BACKDROP_IMG = "https://image.tmdb.org/t/p/w1280";

// Streaming availability is region-specific; JustWatch (TMDb's source) only
// covers one region per lookup, so this is hardcoded rather than configurable.
const WATCH_REGION = "ZA";

function poster(path: string | null): string | null {
  return path ? `${IMG}${path}` : null;
}
function profile(path: string | null | undefined): string | null {
  return path ? `${PROFILE_IMG}${path}` : null;
}
function providerLogo(path: string | null | undefined): string | null {
  return path ? `${PROVIDER_LOGO_IMG}${path}` : null;
}
function backdrop(path: string | null | undefined): string | null {
  return path ? `${BACKDROP_IMG}${path}` : null;
}
function yearOf(date?: string | null): number | null {
  if (!date) return null;
  const y = Number(date.slice(0, 4));
  return Number.isFinite(y) ? y : null;
}

class TmdbHttpError extends Error {
  constructor(public status: number, pathname: string) {
    super(`TMDb ${pathname} failed: ${status}`);
  }
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const REQUEST_TIMEOUT_MS = 8000;
const MAX_ATTEMPTS = 2;

// TMDb is occasionally slow or transiently 5xx/timeouts; retry once and cap
// the wait so a hung request fails on our terms instead of the platform's.
async function tmdbGet(pathname: string, params: Record<string, string> = {}) {
  const url = new URL(`${BASE}${pathname}`);
  url.searchParams.set("api_key", env.tmdbKey);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(url.toString(), { signal: controller.signal });
      if (res.ok) return await res.json();
      if (attempt === MAX_ATTEMPTS || !RETRYABLE_STATUS.has(res.status)) {
        throw new TmdbHttpError(res.status, pathname);
      }
    } catch (e) {
      if (attempt === MAX_ATTEMPTS || e instanceof TmdbHttpError) throw e;
    } finally {
      clearTimeout(timeout);
    }
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error(`TMDb ${pathname} failed: exhausted retries`);
}

export async function searchTitles(q: string): Promise<SearchResult[]> {
  const data = await tmdbGet("/search/multi", { query: q, include_adult: "false" });
  return (data.results ?? [])
    .filter((r: any) => r.media_type === "movie" || r.media_type === "tv")
    .map((r: any): SearchResult => {
      const mediaType: MediaKind = r.media_type === "movie" ? "MOVIE" : "TV";
      return {
        tmdbId: r.id,
        mediaType,
        title: r.title ?? r.name,
        year: yearOf(r.release_date ?? r.first_air_date),
        posterUrl: poster(r.poster_path ?? null),
        popularity: typeof r.popularity === "number" ? r.popularity : 0,
        voteCount: typeof r.vote_count === "number" ? r.vote_count : 0,
      };
    });
}

export async function getTitleDetails(tmdbId: number, mediaType: MediaKind): Promise<TmdbDetails> {
  const path = mediaType === "MOVIE" ? `/movie/${tmdbId}` : `/tv/${tmdbId}`;
  const data = await tmdbGet(path, { append_to_response: "credits,external_ids,watch/providers" });

  const cast: CastMember[] = (data.credits?.cast ?? [])
    .slice(0, 15)
    .map((c: any) => ({ name: c.name, character: c.character ?? "", profileUrl: profile(c.profile_path) }));

  const director =
    (data.credits?.crew ?? []).find((c: any) => c.job === "Director")?.name ?? null;

  const runtime =
    mediaType === "MOVIE"
      ? (data.runtime ?? null)
      : (Array.isArray(data.episode_run_time) && data.episode_run_time.length
          ? data.episode_run_time[0]
          : null);

  const numberOfSeasons =
    mediaType === "TV" && typeof data.number_of_seasons === "number" ? data.number_of_seasons : null;
  const numberOfEpisodes =
    mediaType === "TV" && typeof data.number_of_episodes === "number" ? data.number_of_episodes : null;

  // JustWatch-sourced, via TMDb; flatrate only — this is a watchlist, not a
  // rent/buy shopping guide.
  const regionProviders = data["watch/providers"]?.results?.[WATCH_REGION];
  const watchProviders: WatchProvider[] = (regionProviders?.flatrate ?? []).map((p: any) => ({
    name: p.provider_name,
    logoUrl: providerLogo(p.logo_path),
  }));
  const watchLink: string | null = regionProviders?.link ?? null;

  return {
    tmdbId: data.id,
    mediaType,
    imdbId: data.external_ids?.imdb_id ?? null,
    title: data.title ?? data.name,
    year: yearOf(data.release_date ?? data.first_air_date),
    posterUrl: poster(data.poster_path ?? null),
    backdropUrl: backdrop(data.backdrop_path ?? null),
    overview: data.overview ?? null,
    // TMDb returns "" rather than omitting the field when there's no tagline.
    tagline: data.tagline || null,
    runtime,
    genres: (data.genres ?? []).map((g: any) => g.name),
    cast,
    director,
    tmdbScore: typeof data.vote_average === "number" ? data.vote_average : null,
    numberOfSeasons,
    numberOfEpisodes,
    watchProviders,
    watchLink,
  };
}
