import { getProvider } from "./provider";
import type { RatedTitle, RawSuggestion, ResolvedSuggestion } from "./types";
import { saveRecommendationSet, getDismissedKeySet } from "@/lib/recommendations";
import { evaluateMatch } from "@/lib/tmdbMatch";
import { searchTitles } from "@/lib/tmdb";
import { prisma } from "@/lib/prisma";
import { Status, type RecommendationSet } from "@prisma/client";
import type { MediaKind } from "@/lib/types";

// Re-exported so the API route can distinguish timeout vs failure without
// importing the provider module directly.
export { RecommendationError } from "./gemini";

export interface GenerateResult {
  empty: boolean;
  set: RecommendationSet | null;
}

// The model doesn't need an entire (100+ title) watched list to infer taste,
// and an unbounded history inflates the prompt and the model's thinking, which
// is what starved the output budget. Send at most the strongest-signal slice:
// highest-rated first, most-recently-watched as the tiebreak.
const MAX_HISTORY = 50;

// Only WATCHED titles that carry a rating feed the recommender, mapped to the
// privacy whitelist here (title, year, mediaType, myRating) so nothing else can
// reach the provider.
export async function buildRatedHistory(): Promise<RatedTitle[]> {
  const rows = await prisma.title.findMany({
    where: { status: Status.WATCHED, myRating: { not: null } },
    select: { title: true, year: true, mediaType: true, myRating: true },
    orderBy: [{ myRating: "desc" }, { watchedAt: "desc" }],
    take: MAX_HISTORY,
  });
  return rows.map((r) => ({
    title: r.title,
    year: r.year,
    mediaType: r.mediaType as MediaKind,
    myRating: r.myRating,
  }));
}

// Same or adjacent year only; if the model gave no year, don't gate on it.
function yearMatches(wanted: number | null, actual: number | null): boolean {
  if (wanted == null) return true;
  if (actual == null) return false;
  return Math.abs(actual - wanted) <= 1;
}

// Turn blind LLM titles into real, linkable, genuinely-new suggestions. Reuses
// the shared TMDb matcher (evaluateMatch / pickDominantCandidate) with the
// LLM's mediaType + year as strong pre-filters, DROPS anything ambiguous or
// with no dominant match rather than guessing, dedupes, and excludes anything
// already on a list (Want/Watched) or permanently dismissed.
export async function resolveSuggestions(raw: RawSuggestion[]): Promise<ResolvedSuggestion[]> {
  const resolved: ResolvedSuggestion[] = [];
  const seen = new Set<string>();
  const dismissed = await getDismissedKeySet();

  for (const s of raw) {
    const results = await searchTitles(s.title);
    // Strong pre-filters first: the model's media type and (if given) year.
    const filtered = results.filter((r) => r.mediaType === s.mediaType && yearMatches(s.year, r.year));
    const match = evaluateMatch(s.title, filtered);
    // review == no close/dominant match. Drop it; a missing rec beats a wrong one.
    if (match.outcome === "review" || !match.candidate) continue;

    const c = match.candidate;
    const key = `${c.mediaType}:${c.tmdbId}`;
    if (seen.has(key)) continue; // two suggestions resolved to the same title
    seen.add(key);
    if (dismissed.has(key)) continue; // permanently "not interested"

    const existing = await prisma.title.findUnique({
      where: { tmdbId_mediaType: { tmdbId: c.tmdbId, mediaType: c.mediaType } },
      select: { id: true },
    });
    if (existing) continue; // already on a list; only suggest genuinely new titles

    resolved.push({
      tmdbId: c.tmdbId,
      mediaType: c.mediaType,
      title: c.title,
      year: c.year,
      posterUrl: c.posterUrl,
      reason: s.reason,
    });
  }

  return resolved;
}

// Build history → provider → resolve → persist. The provider throws (→ the
// route maps 429/timeout/malformed) only on GENUINE failures. Running out of
// new titles is NOT a failure: if the model responded fine but nothing new
// survives filtering (all on-list/watched/dismissed, or nothing resolved), we
// save that empty set so the screen shows "nothing new to suggest".
export async function generateRecommendations(): Promise<GenerateResult> {
  const history = await buildRatedHistory();
  // Empty history is a valid state, not an error: the caller returns 200
  // { empty: true } and no provider call is made.
  if (history.length === 0) return { empty: true, set: null };

  const provider = getProvider();
  const raw = await provider.recommend({ history });
  const resolved = await resolveSuggestions(raw);

  const set = await saveRecommendationSet({
    suggestions: resolved,
    model: provider.model,
    sourceCount: history.length,
  });
  return { empty: false, set };
}
