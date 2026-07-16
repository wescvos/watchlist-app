"use client";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ListToggle } from "@/components/ListToggle";
import { TitleCard, type CardTitle } from "@/components/TitleCard";

type Status = "WANT" | "WATCHED";

// Isolated so only this reads the URL — keeps the rest of the page server-rendered
// instead of the whole tree bailing to client-only rendering for useSearchParams.
function UrlStatusSync({ onStatus }: { onStatus: (s: Status) => void }) {
  const searchParams = useSearchParams();
  const raw = searchParams.get("status");
  useEffect(() => {
    if (raw === "WANT" || raw === "WATCHED") onStatus(raw);
  }, [raw, onStatus]);
  return null;
}

interface ListState {
  titles: CardTitle[];
  loaded: boolean;
  fetching: boolean;
  error: boolean;
}

const emptyListState: ListState = { titles: [], loaded: false, fetching: false, error: false };
const STATUSES: Status[] = ["WANT", "WATCHED"];
const SORT_CAPTION: Record<Status, string> = { WANT: "By date added", WATCHED: "By date watched" };

// Module-level so it survives a Home remount (e.g. Back from a title detail
// page), not just tab switches within one mount — otherwise the return trip
// shows an empty skeleton for a beat, which visually breaks scroll restoration
// even though the browser technically restored the scroll offset underneath.
const listCache: Record<Status, ListState> = { WANT: emptyListState, WATCHED: emptyListState };

export default function Home() {
  const [status, setStatus] = useState<Status>("WANT");
  const [reloadToken, setReloadToken] = useState(0);
  const [genreFilter, setGenreFilter] = useState<string | null>(null);
  const [lists, setListsState] = useState<Record<Status, ListState>>(() => listCache);
  const setLists = useCallback((updater: (prev: Record<Status, ListState>) => Record<Status, ListState>) => {
    setListsState((prev) => {
      const next = updater(prev);
      Object.assign(listCache, next);
      return next;
    });
  }, []);
  const skipNextStatusFetch = useRef(true);
  const router = useRouter();

  // Keep the active tab in the URL (replace, not push) so Back from a title
  // detail page restores the tab you were actually on instead of resetting.
  function changeStatus(next: Status) {
    setStatus(next);
    router.replace(next === "WANT" ? "/" : `/?status=${next}`, { scroll: false });
  }
  const handleUrlStatus = useCallback((s: Status) => setStatus(s), []);

  const load = useCallback((target: Status) => {
    let ignore = false;
    setLists((prev) => ({ ...prev, [target]: { ...prev[target], fetching: true } }));
    fetch(`/api/titles?status=${target}`)
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((data: CardTitle[]) => {
        if (ignore) return;
        setLists((prev) => ({ ...prev, [target]: { titles: data, loaded: true, fetching: false, error: false } }));
      })
      .catch(() => {
        if (ignore) return;
        setLists((prev) => ({ ...prev, [target]: { ...prev[target], loaded: true, fetching: false, error: true } }));
      });
    return () => {
      ignore = true;
    };
  }, [setLists]);

  // Load both lists once so tab counts and the inactive tab's grid are ready before it's opened.
  useEffect(() => {
    const cancels = STATUSES.map((s) => load(s));
    return () => cancels.forEach((cancel) => cancel());
  }, [load]);

  // Revalidate the active list in the background whenever it's switched to (skip the mount fetch above).
  useEffect(() => {
    if (skipNextStatusFetch.current) {
      skipNextStatusFetch.current = false;
      return;
    }
    return load(status);
  }, [status, reloadToken, load]);

  // Keep the list current when the installed app is resumed from the background.
  useEffect(() => {
    function onVisibilityChange() {
      if (document.visibilityState === "visible") setReloadToken((n) => n + 1);
    }
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => document.removeEventListener("visibilitychange", onVisibilityChange);
  }, []);

  const current = lists[status];
  const showSkeleton = !current.loaded;
  const showError = current.loaded && current.error && current.titles.length === 0;
  const showEmpty = current.loaded && !current.error && current.titles.length === 0;
  const counts = {
    WANT: lists.WANT.loaded ? lists.WANT.titles.length : null,
    WATCHED: lists.WATCHED.loaded ? lists.WATCHED.titles.length : null,
  };

  // Chips are built only from genres actually present in the Want list, so a
  // stale selection (e.g. the last title with that genre got removed) just
  // falls back to unfiltered rather than showing an active chip with no matches.
  const wantGenres = Array.from(new Set(lists.WANT.titles.flatMap((t) => t.genres))).sort();
  const activeGenre = status === "WANT" && genreFilter && wantGenres.includes(genreFilter) ? genreFilter : null;
  const showGenreFilter = status === "WANT" && !showSkeleton && !showError && !showEmpty && wantGenres.length > 0;
  const displayTitles = activeGenre ? current.titles.filter((t) => t.genres.includes(activeGenre)) : current.titles;

  return (
    <main className="mx-auto w-full max-w-2xl p-4 pb-24">
      <Suspense fallback={null}>
        <UrlStatusSync onStatus={handleUrlStatus} />
      </Suspense>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Watchlist</h1>
        <Link
          href="/search"
          className="rounded-lg bg-foreground px-3 py-2 text-sm text-background transition-opacity hover:opacity-90 active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        >
          + Add
        </Link>
      </div>
      <ListToggle value={status} onChange={changeStatus} counts={counts} />
      {!showSkeleton && !showError && !showEmpty && (
        <p className="mt-4 meta">{SORT_CAPTION[status]}</p>
      )}
      {showGenreFilter && (
        <div className="-mx-4 mt-3 flex gap-1.5 overflow-x-auto scrollbar-hide px-4 pb-1 [-webkit-overflow-scrolling:touch]">
          <button
            type="button"
            onClick={() => setGenreFilter(null)}
            aria-pressed={activeGenre === null}
            className={`flex-shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 font-mono text-[11px] uppercase tracking-wide transition-colors active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground ${
              activeGenre === null
                ? "bg-foreground text-background"
                : "bg-gray-100 text-gray-500 hover:text-foreground dark:bg-white/10"
            }`}
          >
            All
          </button>
          {wantGenres.map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGenreFilter(activeGenre === g ? null : g)}
              aria-pressed={activeGenre === g}
              className={`flex-shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 font-mono text-[11px] uppercase tracking-wide transition-colors active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground ${
                activeGenre === g
                  ? "bg-foreground text-background"
                  : "bg-gray-100 text-gray-500 hover:text-foreground dark:bg-white/10"
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      )}
      {showSkeleton ? (
        <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4" aria-hidden="true">
          {[0, 1, 2, 3, 4, 5].map((i) => (
            <div key={i} className="aspect-[2/3] w-full animate-pulse rounded-lg bg-gray-200 motion-reduce:animate-none dark:bg-white/10" />
          ))}
        </div>
      ) : showError ? (
        <div className="mt-8 py-8 text-center">
          <p role="alert" className="text-sm text-red-600 dark:text-red-400">Couldn&rsquo;t load your list.</p>
          <button
            onClick={() => setReloadToken((n) => n + 1)}
            disabled={current.fetching}
            className="mt-3 rounded-lg border border-black/12 px-4 py-2 text-sm font-medium transition-colors hover:bg-gray-100 active:bg-gray-100 disabled:opacity-50 dark:border-white/15 dark:hover:bg-white/10 dark:active:bg-white/10"
          >
            {current.fetching ? "Retrying…" : "Retry"}
          </button>
        </div>
      ) : showEmpty ? (
        status === "WANT" ? (
          <div className="mt-8 flex flex-col items-center py-8 text-center">
            <p className="font-medium">Nothing on your list</p>
            <p className="mt-1 text-sm text-gray-500">Find something to watch.</p>
            <Link
              href="/search"
              className="mt-4 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              Search titles
            </Link>
          </div>
        ) : (
          <div className="mt-8 py-8 text-center">
            <p className="font-medium">Nothing watched yet</p>
            <p className="mt-1 text-sm text-gray-500">Titles move here when you mark them watched.</p>
          </div>
        )
      ) : (
        <div className="mt-2 grid grid-cols-3 gap-3 sm:grid-cols-4 fade-in">
          {displayTitles.map((t) => <TitleCard key={t.id} t={t} />)}
        </div>
      )}
      <Link
        href="/search"
        aria-label="Add title"
        className="fixed bottom-[calc(1.5rem+env(safe-area-inset-bottom))] left-4 z-10 flex h-14 w-14 items-center justify-center rounded-full bg-foreground text-background transition-opacity hover:opacity-90 active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background"
      >
        <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
      </Link>
    </main>
  );
}
