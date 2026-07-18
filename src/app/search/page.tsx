"use client";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { BackLink } from "@/components/BackLink";
import type { SearchResultWithLibrary } from "@/lib/types";

type Result = SearchResultWithLibrary;

const DEBOUNCE_MS = 350;
const MIN_LIVE_QUERY_LENGTH = 2;
const POSTER_WALL_SIZE = 12;

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
  const [wallPosters, setWallPosters] = useState<string[]>([]);
  const router = useRouter();
  const searchedForRef = useRef("");
  const requestIdRef = useRef(0);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const skipInitialDebounce = useRef(true);
  const inputRef = useRef<HTMLInputElement>(null);

  // Belt-and-suspenders alongside the native autoFocus attribute below: some
  // mobile browsers only reliably open the keyboard from an imperative focus().
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Decorative poster wall for the pre-search state, built from the library
  // (Want first, padded with Watched if thin). Non-blocking: the plain state
  // renders immediately and the wall fades in when data lands; a failure just
  // leaves the plain glyph state.
  useEffect(() => {
    let ignore = false;
    async function loadPosters(status: "WANT" | "WATCHED"): Promise<string[]> {
      const res = await fetch(`/api/titles?status=${status}`);
      if (!res.ok) return [];
      const titles: { posterUrl: string | null }[] = await res.json();
      return titles.map((t) => t.posterUrl).filter((u): u is string => u != null);
    }
    (async () => {
      try {
        let posters = await loadPosters("WANT");
        if (posters.length < POSTER_WALL_SIZE) posters = posters.concat(await loadPosters("WATCHED"));
        if (!ignore) {
          // w185 is plenty for small muted tiles — swap the stored URL's size segment.
          setWallPosters(posters.slice(0, POSTER_WALL_SIZE).map((u) => u.replace("/w500/", "/w185/")));
        }
      } catch {
        // Decorative only.
      }
    })();
    return () => {
      ignore = true;
    };
  }, []);

  const performSearch = useCallback(async (term: string) => {
    // Mark this term as in-flight synchronously so the debounce effect and
    // UrlQuerySync never double-fire a search for the same term.
    searchedForRef.current = term;
    const requestId = ++requestIdRef.current;
    const isCurrent = () => requestId === requestIdRef.current;
    setBusy(true);
    setSearchError("");
    try {
      const res = await fetch(`/api/search?q=${encodeURIComponent(term)}`);
      if (!res.ok) throw new Error();
      const data: Result[] = await res.json();
      if (!isCurrent()) return; // an older response must never overwrite a newer one
      setResults(data);
    } catch {
      if (!isCurrent()) return;
      setResults([]);
      setSearchError("Search isn't responding right now. Try again in a moment.");
    } finally {
      if (isCurrent()) {
        setSearchedFor(term);
        setSearched(true);
        setBusy(false);
      }
    }
  }, []);

  // Restore a search carried in the URL — on first load, or when Back/Forward changes it.
  const handleUrlQuery = useCallback((term: string) => {
    if (term === searchedForRef.current) return;
    setQ(term);
    performSearch(term);
  }, [performSearch]);

  // Live search: fire once, ~350ms after typing stops, for queries of 2+
  // characters. The URL is synced when the search fires (not per keystroke),
  // via replace, so history never fills with per-character entries.
  useEffect(() => {
    if (skipInitialDebounce.current) {
      // The mount run still sees the pre-restore q="" — resetting here would
      // cancel a URL-restore search that UrlQuerySync (child effect, runs
      // first) may have just started.
      skipInitialDebounce.current = false;
      return;
    }
    const term = q.trim();
    if (term.length < MIN_LIVE_QUERY_LENGTH) {
      // Deleting below the threshold returns to the pre-search state — unless
      // this exact short term is already being searched (restored from the
      // URL or submitted explicitly), which we leave alone. The ref-is-empty
      // check makes the reset idempotent (ref "" ⇒ state already clean), so
      // an effect re-run can never loop on fresh state churn.
      if (searchedForRef.current !== "" && term !== searchedForRef.current) {
        searchedForRef.current = "";
        requestIdRef.current++; // discard any in-flight response
        setResults([]);
        setSearched(false);
        setSearchedFor("");
        setSearchError("");
        setBusy(false);
      }
      return;
    }
    if (term === searchedForRef.current) return; // already searched or in flight
    debounceTimer.current = setTimeout(() => {
      if (term === searchedForRef.current) return; // e.g. Enter fired it first
      performSearch(term);
      router.replace(`/search?q=${encodeURIComponent(term)}`, { scroll: false });
    }, DEBOUNCE_MS);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [q, performSearch, router]);

  async function run(e: React.FormEvent) {
    e.preventDefault();
    const term = q.trim();
    if (!term) return;
    inputRef.current?.blur();
    await performSearch(term);
    router.replace(`/search?q=${encodeURIComponent(term)}`, { scroll: false });
  }

  // Wipe the query and everything downstream of it, returning to the initial
  // pre-search state. Cancels any pending debounce and invalidates in-flight
  // requests so a stale response can't repopulate results after clearing. The
  // URL's ?q is cleared too so the cleared slate survives a reload (and
  // searchedForRef reset keeps a re-typed identical term working).
  function clearSearch() {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    requestIdRef.current++;
    setQ("");
    setResults([]);
    setSearched(false);
    setSearchedFor("");
    setSearchError("");
    setBusy(false);
    searchedForRef.current = "";
    router.replace("/search", { scroll: false });
    inputRef.current?.focus();
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
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search movies and series"
            aria-label="Search movies and series"
            enterKeyHint="search"
            className="w-full rounded-lg border border-black/10 bg-gray-50 py-3 pl-9 pr-11 text-base placeholder:text-gray-400 focus-visible:border-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground sm:text-sm dark:border-white/10 dark:bg-white/5"
            autoFocus
          />
          {q.length > 0 && (
            <button
              type="button"
              onClick={clearSearch}
              aria-label="Clear search"
              className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-gray-400 transition-colors hover:text-foreground active:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
            >
              <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          )}
        </div>
        <button className="rounded-lg bg-foreground px-4 text-sm font-medium text-background transition-opacity hover:opacity-90 active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background">
          Search
        </button>
      </form>

      {busy && results.length === 0 ? (
        /* Skeletons only for a search from empty — when results are already on
           screen, a keystroke-triggered re-search keeps them visible with a
           subtle busy indicator instead of flashing skeletons. */
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
          <p className={`mb-2 meta ${busy ? "animate-pulse motion-reduce:animate-none" : ""}`}>
            {busy ? "Searching…" : `${results.length} result${results.length === 1 ? "" : "s"}`}
          </p>
          <ul className={`space-y-2 fade-in transition-opacity ${busy ? "opacity-60" : ""}`}>
            {results.map((r) => (
              <li key={`${r.mediaType}-${r.tmdbId}`}>
                <Link
                  href={r.library ? `/title/${r.library.id}` : `/preview/${r.mediaType.toLowerCase()}/${r.tmdbId}`}
                  className="flex items-center gap-3 rounded-lg border border-black/8 p-2 transition-colors hover:bg-gray-100 active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground dark:border-white/10 dark:hover:bg-white/10 dark:active:bg-white/10"
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
                    {r.library && (
                      <p className="mt-0.5 meta">{r.library.status === "WATCHED" ? "Watched" : "On list"}</p>
                    )}
                  </div>
                  <svg viewBox="0 0 24 24" className="h-4 w-4 flex-shrink-0 text-gray-300 dark:text-white/20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M9 6l6 6-6 6" />
                  </svg>
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : searched ? (
        <div className="py-16 text-center">
          <p className="font-medium">No matches for “{searchedFor}”</p>
          <p className="mt-1 text-sm text-gray-500">Check the spelling or try another title.</p>
        </div>
      ) : wallPosters.length > 0 ? (
        /* The app's front door: a muted mosaic of the library's own posters,
           purely decorative, with the empty-state line as a title over it. */
        <div className="relative fade-in">
          <div aria-hidden="true" className="grid grid-cols-4 gap-2 sm:grid-cols-6">
            {wallPosters.map((src, i) => (
              <div key={i} className="aspect-[2/3] overflow-hidden rounded-md bg-gray-100 dark:bg-white/5">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={src} alt="" loading="lazy" className="h-full w-full object-cover opacity-25 dark:opacity-20" />
              </div>
            ))}
          </div>
          <div aria-hidden="true" className="pointer-events-none absolute inset-0 bg-gradient-to-b from-transparent via-transparent to-background" />
          <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <p className="font-medium">Find something to watch</p>
            <p className="mt-1 meta">Search movies and series to add to your list</p>
          </div>
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
