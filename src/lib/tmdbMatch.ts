import type { SearchResult } from "@/lib/types";

// Title-to-TMDb disambiguation, shared by the Google Takeout import
// (scripts/import-google-takeout.ts) and the Recommended feature's suggestion
// resolver. Extracted verbatim from the import script so the two paths use one
// matcher and cannot drift; behaviour is unchanged.

export function normalize(s: string): string {
  return s
    .normalize("NFKD")
    // Combining diacritical marks (U+0300–U+036F), verbatim from the original.
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

export function isCloseMatch(query: string, candidate: string): boolean {
  const a = normalize(query);
  const b = normalize(candidate);
  if (!a || !b) return false;
  if (a === b) return true;
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  return dist <= Math.max(1, Math.floor(maxLen * 0.12));
}

// Tiebreak for the ambiguous bucket only: auto-pick a candidate over the rest
// of an equally-title-matching field, but only when it dominates by a real
// order of magnitude on a stable TMDb signal — not a marginal edge. Tried
// against vote_count first (a slow-moving, accumulated signal that's hard to
// game), falling back to popularity (catches brand-new releases that haven't
// accumulated votes yet but are clearly the one meant).
const DOMINANCE_RATIO = 10;
const MIN_VOTE_COUNT_FLOOR = 50;
const MIN_POPULARITY_FLOOR = 20;

export function pickDominantCandidate(candidates: SearchResult[]): { winner: SearchResult; note: string } | null {
  for (const metric of ["voteCount", "popularity"] as const) {
    const floor = metric === "voteCount" ? MIN_VOTE_COUNT_FLOOR : MIN_POPULARITY_FLOOR;
    const sorted = [...candidates].sort((a, b) => b[metric] - a[metric]);
    const [top, runnerUp] = sorted;
    if (top[metric] >= floor && top[metric] >= (runnerUp?.[metric] ?? 0) * DOMINANCE_RATIO) {
      const label = metric === "voteCount" ? "vote count" : "popularity";
      return {
        winner: top,
        note: `${label} dominance: ${top[metric]} vs runner-up ${runnerUp?.[metric] ?? 0}`,
      };
    }
  }
  return null;
}

export interface MatchOutcome {
  outcome: "confident" | "tiebreak" | "review";
  reason?: string;
  candidate?: SearchResult;
}

export function evaluateMatch(query: string, results: SearchResult[]): MatchOutcome {
  if (results.length === 0) return { outcome: "review", reason: "no TMDb results" };
  const top = results[0];
  if (!isCloseMatch(query, top.title)) {
    return {
      outcome: "review",
      reason: `no close match — top result was "${top.title}" (${top.mediaType}${top.year ? " " + top.year : ""}, id ${top.tmdbId})`,
    };
  }
  const closeMatches = results.filter((r) => isCloseMatch(query, r.title));
  const distinctTargets = new Map<string, SearchResult>();
  for (const r of closeMatches) distinctTargets.set(`${r.mediaType}:${r.tmdbId}`, r);
  const candidates = [...distinctTargets.values()];
  if (candidates.length === 1) {
    return { outcome: "confident", candidate: top };
  }

  const dominant = pickDominantCandidate(candidates);
  if (dominant) {
    const listNote = candidates
      .map((r) => `"${r.title}" (${r.mediaType}${r.year ? " " + r.year : ""}, id ${r.tmdbId}, votes ${r.voteCount}, pop ${r.popularity.toFixed(1)})`)
      .join(", ");
    return {
      outcome: "tiebreak",
      candidate: dominant.winner,
      reason: `picked "${dominant.winner.title}" (${dominant.winner.mediaType}${dominant.winner.year ? " " + dominant.winner.year : ""}, id ${dominant.winner.tmdbId}) by ${dominant.note} — full field: ${listNote}`,
    };
  }

  const list = candidates
    .slice(0, 5)
    .map((r) => `"${r.title}" (${r.mediaType}${r.year ? " " + r.year : ""}, id ${r.tmdbId})`)
    .join(", ");
  return { outcome: "review", reason: `ambiguous — multiple close matches: ${list}` };
}
