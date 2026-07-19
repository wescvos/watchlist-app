"use client";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ListToggle } from "@/components/ListToggle";
import { TitleCard, type CardTitle } from "@/components/TitleCard";
import type { MediaKind } from "@/lib/types";
import { listCache, type ListState, type Status } from "@/lib/listCache";

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

// Same isolation reasoning as UrlStatusSync — also doubles as the fix for the
// genre filter resetting on Back from a title detail page: since it's read
// from the URL rather than held only in component state, it survives a Home
// remount the same way the active tab already does.
function UrlGenreSync({ onGenre }: { onGenre: (g: string | null) => void }) {
  const searchParams = useSearchParams();
  const raw = searchParams.get("genre");
  useEffect(() => {
    onGenre(raw);
  }, [raw, onGenre]);
  return null;
}

// Same mechanism as UrlGenreSync, for the independent movie/series filter.
function UrlTypeSync({ onType }: { onType: (t: MediaKind | null) => void }) {
  const searchParams = useSearchParams();
  const raw = searchParams.get("type");
  useEffect(() => {
    onType(raw === "MOVIE" || raw === "TV" ? raw : null);
  }, [raw, onType]);
  return null;
}

const STATUSES: Status[] = ["WANT", "WATCHED"];
const SORT_CAPTION: Record<Status, string> = { WANT: "By date added", WATCHED: "By date watched" };

export default function Home() {
  const [status, setStatus] = useState<Status>("WANT");
  const [reloadToken, setReloadToken] = useState(0);
  const [genreFilter, setGenreFilterState] = useState<string | null>(null);
  const [typeFilter, setTypeFilterState] = useState<MediaKind | null>(null);
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

  // The active tab plus the (Want-only) genre and type filters all live in the
  // URL, not just component state, so Back from a title detail page restores
  // all three instead of resetting — same fix as the scroll-position issue,
  // same mechanism.
  function buildUrl(s: Status, genre: string | null, type: MediaKind | null): string {
    const params = new URLSearchParams();
    if (s !== "WANT") params.set("status", s);
    if (s === "WANT" && genre) params.set("genre", genre);
    if (s === "WANT" && type) params.set("type", type);
    const qs = params.toString();
    return qs ? `/?${qs}` : "/";
  }

  function changeStatus(next: Status) {
    setStatus(next);
    router.replace(buildUrl(next, genreFilter, typeFilter), { scroll: false });
  }
  function changeGenre(next: string | null) {
    setGenreFilterState(next);
    router.replace(buildUrl(status, next, typeFilter), { scroll: false });
  }
  function changeType(next: MediaKind | null) {
    setTypeFilterState(next);
    router.replace(buildUrl(status, genreFilter, next), { scroll: false });
  }
  const handleUrlStatus = useCallback((s: Status) => setStatus(s), []);
  const handleUrlGenre = useCallback((g: string | null) => setGenreFilterState(g), []);
  const handleUrlType = useCallback((t: MediaKind | null) => setTypeFilterState(t), []);

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

  // Chips are built only from genres actually present in the Want list (not
  // recomputed against the active type filter), so a stale genre selection
  // just falls back to unfiltered, and toggling the type filter never makes
  // genre chips appear/disappear.
  const wantGenres = Array.from(new Set(lists.WANT.titles.flatMap((t) => t.genres))).sort();
  const activeGenre = status === "WANT" && genreFilter && wantGenres.includes(genreFilter) ? genreFilter : null;
  const activeType = status === "WANT" ? typeFilter : null;
  const showFilterRow = status === "WANT" && !showSkeleton && !showError && !showEmpty;
  const displayTitles = current.titles.filter(
    (t) => (!activeGenre || t.genres.includes(activeGenre)) && (!activeType || t.mediaType === activeType),
  );
  const showFilteredEmpty = !showSkeleton && !showError && !showEmpty && displayTitles.length === 0;
  const typeLabel = (t: MediaKind) => (t === "MOVIE" ? "movies" : "series");
  const filteredEmptyMessage = activeType && activeGenre
    ? `No ${typeLabel(activeType)} in ${activeGenre} yet`
    : activeType
    ? `No ${typeLabel(activeType)} yet`
    : activeGenre
    ? `No titles in ${activeGenre} yet`
    : "Nothing matches this filter yet";

  // Shared style for both filter dimensions — same mono chip/pill vocabulary
  // used on the detail page's genre pills, just interactive here.
  function chipClass(active: boolean): string {
    return `flex-shrink-0 whitespace-nowrap rounded-full px-2.5 py-1 font-mono text-[11px] uppercase tracking-wide transition-colors active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground ${
      active ? "bg-foreground text-background" : "bg-gray-100 text-gray-500 hover:text-foreground dark:bg-white/10"
    }`;
  }

  return (
    <main className="mx-auto w-full max-w-2xl p-4 pb-24">
      <Suspense fallback={null}>
        <UrlStatusSync onStatus={handleUrlStatus} />
      </Suspense>
      <Suspense fallback={null}>
        <UrlGenreSync onGenre={handleUrlGenre} />
      </Suspense>
      <Suspense fallback={null}>
        <UrlTypeSync onType={handleUrlType} />
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
      {showFilterRow && (
        <div className="-mx-4 mt-3 flex gap-1.5 overflow-x-auto scrollbar-hide px-4 pb-1 [-webkit-overflow-scrolling:touch]">
          <button type="button" onClick={() => changeType(null)} aria-pressed={activeType === null} className={chipClass(activeType === null)}>
            All
          </button>
          <button
            type="button"
            onClick={() => changeType(activeType === "MOVIE" ? null : "MOVIE")}
            aria-pressed={activeType === "MOVIE"}
            className={chipClass(activeType === "MOVIE")}
          >
            Movies
          </button>
          <button
            type="button"
            onClick={() => changeType(activeType === "TV" ? null : "TV")}
            aria-pressed={activeType === "TV"}
            className={chipClass(activeType === "TV")}
          >
            Series
          </button>
          {wantGenres.length > 0 && (
            <>
              <div className="mx-0.5 h-5 w-px flex-shrink-0 self-center bg-black/10 dark:bg-white/10" aria-hidden="true" />
              <button type="button" onClick={() => changeGenre(null)} aria-pressed={activeGenre === null} className={chipClass(activeGenre === null)}>
                All
              </button>
              {wantGenres.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => changeGenre(activeGenre === g ? null : g)}
                  aria-pressed={activeGenre === g}
                  className={chipClass(activeGenre === g)}
                >
                  {g}
                </button>
              ))}
            </>
          )}
        </div>
      )}
      {showSkeleton ? (
        <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4" aria-hidden="true">
          {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
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
      ) : showFilteredEmpty ? (
        <div className="mt-8 py-8 text-center">
          <p className="text-sm text-gray-500">{filteredEmptyMessage}</p>
        </div>
      ) : (
        <div className="mt-2 grid grid-cols-3 gap-3 sm:grid-cols-4 fade-in">
          {displayTitles.map((t) => <TitleCard key={t.id} t={t} status={status} />)}
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
