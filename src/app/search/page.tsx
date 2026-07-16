"use client";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { BackLink } from "@/components/BackLink";
import type { SearchResultWithLibrary } from "@/lib/types";

type Result = SearchResultWithLibrary;

// Isolated so only this reads the URL — keeps the rest of the page server-rendered
// instead of the whole tree bailing to client-only rendering for useSearchParams.
function UrlQuerySync({ onQuery }: { onQuery: (term: string) => void }) {
  const searchParams = useSearchParams();
  const term = (searchParams.get("q") ?? "").trim();
  useEffect(() => {
    if (term) onQuery(term);
  }, [term, onQuery]);
  return null;
}

export default function SearchPage() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  const [searched, setSearched] = useState(false);
  const [searchedFor, setSearchedFor] = useState("");
  const [searchError, setSearchError] = useState("");
  const [adding, setAdding] = useState<number | null>(null);
  const [addError, setAddError] = useState("");
  const router = useRouter();
  const searchedForRef = useRef("");

  const performSearch = useCallback(async (term: string) => {
    setBusy(true);
    setAddError("");
    setSearchError("");
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`);
      if (!res.ok) throw new Error();
      setResults(await res.json());
    } catch {
      setResults([]);
      setSearchError("Search isn't responding right now. Try again in a moment.");
    } finally {
      searchedForRef.current = term;
      setSearchedFor(term);
      setSearched(true);
      setBusy(false);
    }
  }, []);

  // Restore a search carried in the URL — on first load, or when Back/Forward changes it.
  const handleUrlQuery = useCallback((term: string) => {
    if (term === searchedForRef.current) return;
    setQ(term);
    performSearch(term);
  }, [performSearch]);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    const term = q.trim();
    if (!term) return;
    await performSearch(term);
    router.replace(`/search?q=${encodeURIComponent(term)}`, { scroll: false });
  }

  async function add(r: Result, status: "WANT" | "WATCHED") {
    setAdding(r.tmdbId);
    setAddError("");
    try {
      const res = await fetch("/api/titles", {
        method: "POST",
        body: JSON.stringify({ tmdbId: r.tmdbId, mediaType: r.mediaType, status }),
      });
      if (!res.ok) {
        setAddError(`Couldn't add "${r.title}". Please try again.`);
        return;
      }
      const t = await res.json();
      setResults((prev) =>
        prev.map((item) =>
          item.tmdbId === r.tmdbId && item.mediaType === r.mediaType
            ? { ...item, library: { id: t.id, status } }
            : item
        )
      );
    } catch {
      setAddError(`Couldn't add "${r.title}". Please try again.`);
    } finally {
      setAdding(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl p-4 pb-24">
      <Suspense fallback={null}>
        <UrlQuerySync onQuery={handleUrlQuery} />
      </Suspense>
      <div className="mb-4 flex items-center gap-2">
        <BackLink href="/" label="Back to watchlist" />
        <h1 className="text-lg font-semibold tracking-tight">Search</h1>
      </div>

      <form onSubmit={run} className="mb-5 flex gap-2">
        <div className="relative flex-1">
          <svg viewBox="0 0 24 24" className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-3.5-3.5" />
          </svg>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search movies and series"
            aria-label="Search movies and series"
            enterKeyHint="search"
            className="w-full rounded-lg border border-black/10 bg-gray-50 py-3 pl-9 pr-3 text-base placeholder:text-gray-400 focus-visible:border-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground sm:text-sm dark:border-white/10 dark:bg-white/5"
            autoFocus
          />
        </div>
        <button className="rounded-lg bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-90 active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background">
          Search
        </button>
      </form>

      {addError && (
        <p role="alert" className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-500/10 dark:text-red-400">
          {addError}
        </p>
      )}

      {busy ? (
        <ul className="space-y-2" aria-hidden="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex items-center gap-3 rounded-lg border border-black/5 p-2 dark:border-white/5">
              <div className="h-20 w-14 flex-shrink-0 animate-pulse rounded bg-gray-200 motion-reduce:animate-none dark:bg-white/10" />
              <div className="min-w-0 flex-1 space-y-2">
                <div className="h-4 w-2/3 animate-pulse rounded bg-gray-200 motion-reduce:animate-none dark:bg-white/10" />
                <div className="h-3 w-1/3 animate-pulse rounded bg-gray-200 motion-reduce:animate-none dark:bg-white/10" />
              </div>
            </li>
          ))}
        </ul>
      ) : searchError ? (
        <p role="alert" className="py-16 text-center text-sm text-red-600 dark:text-red-400">{searchError}</p>
      ) : results.length > 0 ? (
        <>
          <p className="mb-2 meta">
            {results.length} result{results.length === 1 ? "" : "s"}
          </p>
          <ul className="space-y-2 fade-in">
            {results.map((r) => (
              <li
                key={`${r.mediaType}-${r.tmdbId}`}
                className={`flex items-center gap-3 rounded-lg border border-black/8 p-2 transition-opacity dark:border-white/10 ${adding === r.tmdbId ? "opacity-50" : ""}`}
              >
                <div className="h-20 w-14 flex-shrink-0 overflow-hidden rounded bg-gray-100 ring-1 ring-black/5 dark:bg-white/5 dark:ring-white/10">
                  {r.posterUrl && /* eslint-disable-next-line @next/next/no-img-element */
                    <img src={r.posterUrl} alt="" className="h-full w-full object-cover" />}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{r.title}</p>
                  <p className="mt-0.5 meta">
                    {r.mediaType === "TV" ? "TV" : "Movie"}{r.year ? ` · ${r.year}` : ""}
                  </p>
                </div>
                {r.library ? (
                  <Link
                    href={`/title/${r.library.id}`}
                    className="flex h-11 flex-shrink-0 items-center justify-center rounded-lg border border-black/12 px-3 meta transition-colors hover:bg-gray-100 active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground dark:border-white/15 dark:hover:bg-white/10 dark:active:bg-white/10"
                  >
                    {r.library.status === "WATCHED" ? "Watched" : "On list"}
                  </Link>
                ) : (
                  <div className="flex flex-shrink-0 flex-col gap-2.5">
                    <button onClick={() => add(r, "WANT")} disabled={adding === r.tmdbId}
                      className="flex h-11 items-center justify-center rounded-lg bg-foreground px-3 text-xs font-medium text-background transition-opacity hover:opacity-90 active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50">
                      + Want
                    </button>
                    <button onClick={() => add(r, "WATCHED")} disabled={adding === r.tmdbId}
                      className="flex h-11 items-center justify-center rounded-lg border border-black/12 px-3 text-xs font-medium transition-colors hover:bg-gray-100 active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground disabled:opacity-50 dark:border-white/15 dark:hover:bg-white/10 dark:active:bg-white/10">
                      + Watched
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </>
      ) : searched ? (
        <div className="py-16 text-center">
          <p className="font-medium">No matches for “{searchedFor}”</p>
          <p className="mt-1 text-sm text-gray-500">Check the spelling or try another title.</p>
        </div>
      ) : (
        <div className="flex flex-col items-center py-16 text-center">
          <svg viewBox="0 0 48 48" className="h-14 w-14 text-gray-300 dark:text-white/15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <rect x="14" y="10" width="24" height="32" rx="2" />
            <rect x="8" y="14" width="8" height="28" rx="2" className="text-gray-200 dark:text-white/10" />
            <path d="M24 22v8M20 26h8" className="opacity-70" />
          </svg>
          <p className="mt-4 font-medium">Find something to watch</p>
          <p className="mt-1 text-sm text-gray-500">Search movies and series to add to your list.</p>
        </div>
      )}
    </main>
  );
}
