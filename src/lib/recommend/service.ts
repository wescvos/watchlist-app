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

// Sampling sizes. Kept well under the 50 that was proven safe for the thinking
// model's shared token budget, so this can't regress the MAX_TOKENS starvation.
const SAMPLE_SIZE = 40; // total titles sent to the model per refresh
const ANCHOR_COUNT = 10; // always-included top-rated titles

// Weighted sampling without replacement (Efraimidis-Spirakis): each item gets a
// key u^(1/weight); the largest keys win. A higher rating is a higher weight,
// so good films are likelier but not guaranteed, and the winning set differs
// between refreshes. Rating 0 still gets a small non-zero weight (+1).
function weightedSample(items: RatedTitle[], k: number): RatedTitle[] {
  if (items.length <= k) return items;
  return items
    .map((t) => ({ t, key: Math.random() ** (1 / ((t.myRating ?? 0) + 1)) }))
    .sort((a, b) => b.key - a.key)
    .slice(0, k)
    .map((x) => x.t);
}

// Only WATCHED titles that carry a rating feed the recommender, mapped to the
// privacy whitelist here (title, year, mediaType, myRating) so nothing else can
// reach the provider.
//
// Sampling, not the fixed top-50: sending the identical strongest titles every
// refresh made the model reason over the same input and circle the same obvious
// neighbours, which the exclusion filter then mostly removed — a trickle. So we
// anchor on the top-rated few (keeps every refresh on-target) and fill the rest
// with a weighted-random draw from the remaining rated titles (introduces
// variety). This widens the net; it does NOT manufacture endless novelty — the
// genuinely-new pool still shrinks as titles get added/dismissed, which
// graceful exhaustion handles. It only stops ARTIFICIALLY starving the batch.
export async function buildRatedHistory(): Promise<RatedTitle[]> {
  const rows = await prisma.title.findMany({
    where: { status: Status.WATCHED, myRating: { not: null } },
    select: { title: true, year: true, mediaType: true, myRating: true },
    orderBy: [{ myRating: "desc" }, { watchedAt: "desc" }],
  });
  const all: RatedTitle[] = rows.map((r) => ({
    title: r.title,
    year: r.year,
    mediaType: r.mediaType as MediaKind,
    myRating: r.myRating,
  }));
  // Small library: send everything, no sampling, no padding.
  if (all.length <= SAMPLE_SIZE) return all;

  const anchors = all.slice(0, ANCHOR_COUNT);
  const varied = weightedSample(all.slice(ANCHOR_COUNT), SAMPLE_SIZE - ANCHOR_COUNT);
  return [...anchors, ...varied];
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
export interface ResolveResult {
  resolved: ResolvedSuggestion[];
  // Distinct suggestions that resolved to a real TMDb title, BEFORE the
  // Want/Watched/Dismissed exclusion filter. Only used for the diagnostic
  // batch log (raw → matched → new), not for control flow.
  matched: number;
}

export async function resolveSuggestions(raw: RawSuggestion[]): Promise<ResolveResult> {
  const resolved: ResolvedSuggestion[] = [];
  const seen = new Set<string>();
  const dismissed = await getDismissedKeySet();
  let matched = 0;

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
    matched++; // a distinct, real TMDb title (pre-exclusion)
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

  return { resolved, matched };
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
  const { resolved, matched } = await resolveSuggestions(raw);

  // Success-path breadcrumb: three counts only (no content, no key) so a
  // thin-but-successful batch is diagnosable without guessing. raw = what the
  // model returned, matched = resolved to a real TMDb title, new = survived the
  // Want+Watched+Dismissed filter.
  console.log(`[recommend] batch: raw=${raw.length} matched=${matched} new=${resolved.length}`);

  const set = await saveRecommendationSet({
    suggestions: resolved,
    model: provider.model,
    sourceCount: history.length,
  });
  return { empty: false, set };
}
