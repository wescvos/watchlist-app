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

// Same mechanism again, but for both lists at once: each list carries its own
// sort param so Want and Watched remember their sort independently and both
// survive a Home remount (Back from a title page) exactly like the filters do.
// Default is omitted from the URL; only the "rating" state is written.
function UrlSortSync({ onSort }: { onSort: (modes: Record<Status, SortMode>) => void }) {
  const searchParams = useSearchParams();
  const want = searchParams.get("wantSort");
  const watched = searchParams.get("watchedSort");
  useEffect(() => {
    onSort({
      WANT: want === "rating" ? "rating" : "default",
      WATCHED: watched === "rating" ? "rating" : "default",
    });
  }, [want, watched, onSort]);
  return null;
}

const STATUSES: Status[] = ["WANT", "WATCHED"];

// Each list has exactly two sort states: its date-based default (already the
// order the API returns) and a rating-based one. "rating" means IMDb score for
// Want, personal rating for Watched — the caption spells out which.
type SortMode = "default" | "rating";
const SORT_CAPTION: Record<Status, Record<SortMode, string>> = {
  WANT: { default: "By date added", rating: "By IMDb rating" },
  WATCHED: { default: "By date watched", rating: "By my rating" },
};

// imdbScore is stored as a string ("8.5", "N/A", …); anything non-numeric
// reads as no rating so it sorts to the bottom rather than ranking as 0/high.
function imdbNumber(t: CardTitle): number | null {
  if (t.imdbScore == null) return null;
  const n = parseFloat(t.imdbScore);
  return Number.isFinite(n) ? n : null;
}

// Highest rating first; missing ratings always sink to the bottom. Returns 0
// for equal keys so the caller's already-ordered array (date order from the
// server) breaks ties via the engine's stable sort.
function ratingDescNullsLast(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  return b - a;
}

// Pinned-first grouping must survive the rating sort exactly as it does the
// date sort: pinned titles stay grouped on top (ordered by IMDb among
// themselves), unpinned below (same), never interleaved by score.
function sortWantByRating(titles: CardTitle[]): CardTitle[] {
  return titles.slice().sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
    return ratingDescNullsLast(imdbNumber(a), imdbNumber(b));
  });
}

function sortWatchedByRating(titles: CardTitle[]): CardTitle[] {
  return titles.slice().sort((a, b) => ratingDescNullsLast(a.myRating, b.myRating));
}

export default function Home() {
  const [status, setStatus] = useState<Status>("WANT");
  const [reloadToken, setReloadToken] = useState(0);
  const [genreFilter, setGenreFilterState] = useState<string | null>(null);
  const [typeFilter, setTypeFilterState] = useState<MediaKind | null>(null);
  const [sortModes, setSortModes] = useState<Record<Status, SortMode>>({ WANT: "default", WATCHED: "default" });
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
  function buildUrl(s: Status, genre: string | null, type: MediaKind | null, sorts: Record<Status, SortMode>): string {
    const params = new URLSearchParams();
    if (s !== "WANT") params.set("status", s);
    if (s === "WANT" && genre) params.set("genre", genre);
    if (s === "WANT" && type) params.set("type", type);
    // Both lists' sorts are always carried (not just the active one), so
    // switching tabs never drops the other list's remembered sort from the URL.
    if (sorts.WANT === "rating") params.set("wantSort", "rating");
    if (sorts.WATCHED === "rating") params.set("watchedSort", "rating");
    const qs = params.toString();
    return qs ? `/?${qs}` : "/";
  }

  function changeStatus(next: Status) {
    setStatus(next);
    router.replace(buildUrl(next, genreFilter, typeFilter, sortModes), { scroll: false });
  }
  function changeGenre(next: string | null) {
    setGenreFilterState(next);
    router.replace(buildUrl(status, next, typeFilter, sortModes), { scroll: false });
  }
  function changeType(next: MediaKind | null) {
    setTypeFilterState(next);
    router.replace(buildUrl(status, genreFilter, next, sortModes), { scroll: false });
  }
  function toggleSort() {
    const next: SortMode = sortModes[status] === "default" ? "rating" : "default";
    const nextModes = { ...sortModes, [status]: next };
    setSortModes(nextModes);
    router.replace(buildUrl(status, genreFilter, typeFilter, nextModes), { scroll: false });
  }
  const handleUrlStatus = useCallback((s: Status) => setStatus(s), []);
  const handleUrlGenre = useCallback((g: string | null) => setGenreFilterState(g), []);
  const handleUrlType = useCallback((t: MediaKind | null) => setTypeFilterState(t), []);
  const handleUrlSort = useCallback((modes: Record<Status, SortMode>) => setSortModes(modes), []);

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
  const filteredTitles = current.titles.filter(
    (t) => (!activeGenre || t.genres.includes(activeGenre)) && (!activeType || t.mediaType === activeType),
  );
  // Default mode keeps the server order as-is (date-based, pinned-first for
  // Want); only the rating mode re-sorts, per list.
  const sortMode = sortModes[status];
  const displayTitles =
    sortMode === "default"
      ? filteredTitles
      : status === "WANT"
      ? sortWantByRating(filteredTitles)
      : sortWatchedByRating(filteredTitles);
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
      <Suspense fallback={null}>
        <UrlSortSync onSort={handleUrlSort} />
      </Suspense>
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Watchlist</h1>
        <div className="flex items-center gap-1.5">
          {/* Secondary entry ("For You"): subdued ghost styling so the solid
              "+ Add" pill stays the primary action. An action, not a list tab.
              Route stays /recommended; only the label is short. */}
          <Link
            href="/recommended"
            className="rounded-lg px-3 py-2 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-foreground active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground dark:hover:bg-white/10 dark:active:bg-white/10"
          >
            For You
          </Link>
          <Link
            href="/search"
            className="rounded-lg bg-foreground px-3 py-2 text-sm text-background transition-opacity hover:opacity-90 active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background"
          >
            + Add
          </Link>
        </div>
      </div>
      <ListToggle value={status} onChange={changeStatus} counts={counts} />
      {!showSkeleton && !showError && !showEmpty && (
        // The sort caption doubles as the control — tapping it cycles this
        // list's two sort modes. min-h-11 gives a real ~44px tap target
        // around the small text; the negative margin keeps it from adding
        // that full height to the layout, so it sits where the caption did.
        <button
          type="button"
          onClick={toggleSort}
          aria-label={`Sort: ${SORT_CAPTION[status][sortMode]}. Tap to change.`}
          className="mt-2 -mb-2 inline-flex min-h-11 items-center gap-1 rounded meta transition-colors hover:text-foreground active:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
        >
          <span>{SORT_CAPTION[status][sortMode]}</span>
          <svg viewBox="0 0 24 24" className="h-3 w-3 opacity-60" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
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
