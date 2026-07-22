"use client";
import { useCallback, useEffect, useState } from "react";
import { BackLink } from "@/components/BackLink";
import { SuggestionCard } from "@/components/SuggestionCard";
import type { ResolvedSuggestion } from "@/lib/recommend/types";

// Client view of a cached set. Over JSON, suggestions is the stored array and
// generatedAt arrives as an ISO string.
interface RecSet {
  id: string;
  suggestions: ResolvedSuggestion[];
  model: string;
  sourceCount: number;
  generatedAt: string;
}

function formatGeneratedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

export default function RecommendedPage() {
  // loading = initial GET in flight; ready = GET resolved (with a set or null).
  const [loading, setLoading] = useState(true);
  const [set, setSet] = useState<RecSet | null>(null);
  const [generating, setGenerating] = useState(false);
  const [emptyHistory, setEmptyHistory] = useState(false);
  // Soft, non-blocking message. Set on a failed refresh; the cached set (if
  // any) stays on screen — a failed refresh must never blank the list.
  const [message, setMessage] = useState<string | null>(null);

  // Load the cached set on mount and render it instantly. No generation here.
  useEffect(() => {
    let ignore = false;
    (async () => {
      try {
        const res = await fetch("/api/recommendations");
        const data = res.ok ? await res.json() : null;
        if (!ignore && data && typeof data === "object") setSet(data as RecSet);
      } catch {
        // Leave set null; the first-run/generate path still works.
      } finally {
        if (!ignore) setLoading(false);
      }
    })();
    return () => {
      ignore = true;
    };
  }, []);

  const refresh = useCallback(async () => {
    setGenerating(true);
    setMessage(null);
    try {
      const res = await fetch("/api/recommendations", { method: "POST" });
      if (res.ok) {
        const data = await res.json();
        if (data && data.empty) {
          // Valid state, not an error: no rated history to work from.
          setEmptyHistory(true);
        } else {
          setEmptyHistory(false);
          setSet(data as RecSet);
        }
      } else {
        // Non-2xx (502/504): keep whatever set is already showing.
        setMessage("Couldn't refresh recommendations. Showing your last set.");
      }
    } catch {
      setMessage("Couldn't refresh recommendations. Showing your last set.");
    } finally {
      setGenerating(false);
    }
  }, []);

  const suggestions = set?.suggestions ?? [];
  const hasPopulatedSet = set != null && suggestions.length > 0;

  return (
    <main className="mx-auto w-full max-w-2xl p-4 pb-24">
      <div className="mb-4 flex items-center gap-2">
        <BackLink href="/" label="Back to watchlist" />
        <h1 className="text-lg font-semibold tracking-tight">For You</h1>
      </div>

      {/* Caption + Refresh, shown whenever a set exists (populated or empty). */}
      {set != null && (
        <div className="mb-4 flex items-center justify-between gap-3">
          <p className="meta">{set.generatedAt ? `Generated ${formatGeneratedAt(set.generatedAt)}` : ""}</p>
          <button
            type="button"
            onClick={refresh}
            disabled={generating}
            className="rounded-lg border border-black/12 px-3 py-2 text-sm font-medium transition-colors hover:bg-gray-100 active:bg-gray-100 disabled:opacity-50 dark:border-white/15 dark:hover:bg-white/10 dark:active:bg-white/10"
          >
            {generating ? "Refreshing…" : "Refresh"}
          </button>
        </div>
      )}

      {/* Soft error banner: never replaces the content below it. */}
      {message && (
        <p role="status" className="mb-4 rounded-lg bg-gray-100 px-3 py-2 text-sm text-gray-600 dark:bg-white/10 dark:text-gray-300">
          {message}
        </p>
      )}

      {loading ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" aria-hidden="true">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="aspect-[2/3] w-full animate-pulse rounded-lg bg-gray-200 motion-reduce:animate-none dark:bg-white/10" />
          ))}
        </div>
      ) : hasPopulatedSet ? (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 fade-in">
          {suggestions.map((s) => (
            <SuggestionCard key={`${s.mediaType}-${s.tmdbId}`} s={s} />
          ))}
        </div>
      ) : generating ? (
        <p className="py-16 text-center text-sm text-gray-500">Finding recommendations…</p>
      ) : set != null ? (
        // A set came back with nothing new (all resolved titles already listed).
        <div className="py-16 text-center">
          <p className="font-medium">Nothing new to suggest right now</p>
          <p className="mt-1 text-sm text-gray-500">Try refreshing later, or after you rate a few more.</p>
        </div>
      ) : emptyHistory ? (
        <div className="py-16 text-center">
          <p className="font-medium">Rate some watched titles first</p>
          <p className="mt-1 text-sm text-gray-500">Recommendations are based on what you&rsquo;ve watched and rated.</p>
        </div>
      ) : (
        // First run: nothing generated yet.
        <div className="flex flex-col items-center py-16 text-center">
          <p className="font-medium">Get recommendations</p>
          <p className="mt-1 text-sm text-gray-500">Based on your watched titles and the ratings you gave them.</p>
          <button
            type="button"
            onClick={refresh}
            disabled={generating}
            className="mt-4 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 active:opacity-80 disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            {generating ? "Generating…" : "Generate recommendations"}
          </button>
        </div>
      )}
    </main>
  );
}
