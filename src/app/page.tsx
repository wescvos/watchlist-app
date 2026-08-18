"use client";
import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { ListToggle } from "@/components/ListToggle";
import { TitleCard, type CardTitle } from "@/components/TitleCard";
import { LaunchSplash } from "@/components/LaunchSplash";
import type { MediaKind } from "@/lib/types";
import { listCache, type ListState, type Status } from "@/lib/listCache";
import { hydrateListCache, persistLists } from "@/lib/listPersist";
import { LOADING_DELAY_MS } from "@/lib/loadingDelay";

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
  // Withhold the skeleton briefly. Since the list now seeds from localStorage,
  // data usually arrives within a frame or two, so an immediate skeleton
  // appeared and vanished ~300ms later: two different screens in quick
  // succession, which reads as a glitch rather than as loading. Below the
  // threshold we show nothing and go straight from empty to content; only a
  // genuinely slow load crosses it, which is exactly when a skeleton earns its
  // place. Tracked per status so switching to a not-yet-loaded tab gets the same
  // grace period rather than flashing immediately.
  const [skeletonDelayPassed, setSkeletonDelayPassed] = useState<Record<Status, boolean>>({
    WANT: false,
    WATCHED: false,
  });
  // Whether this mount was seeded from disk. A disk-seeded launch is a WARM
  // render, so it must not replay the entrance animation: a fade landing on top
  // of an already-fast swap is the compounding effect that made this worse.
  const [diskSeeded, setDiskSeeded] = useState(false);
  const setLists = useCallback((updater: (prev: Record<Status, ListState>) => Record<Status, ListState>) => {
    setListsState((prev) => {
      const next = updater(prev);
      Object.assign(listCache, next);
      // Persist only when the titles themselves changed, so the fetching/error
      // flag updates don't re-serialize 130 KB for nothing. Writing from inside
      // the updater matches the Object.assign above, and persistLists is
      // idempotent, so a StrictMode double invocation is harmless.
      if (next.WANT.titles !== prev.WANT.titles || next.WATCHED.titles !== prev.WATCHED.titles) {
        persistLists(next);
      }
      return next;
    });
  }, []);
  const skipNextStatusFetch = useRef(true);
  // Per-list snapshot of whether each list's cache was already warm when this
  // Home instance mounted. Gates the grid's entrance animation: a genuine cold
  // load (cache empty → data arrives) fades in; a warm remount (Back from a
  // title page, cache already populated) does not — replaying the fade from
  // opacity 0 is the flash. Keyed per status so a not-yet-loaded tab still
  // animates (and shows its skeleton) when its own data first arrives. NOTE:
  // `loaded` is already seeded synchronously from listCache by the useState
  // above, so a warm list is never `!loaded` on the first frame — there is no
  // skeleton frame on a warm return; this only suppresses the redundant fade.
  // useState (not useRef) with a lazy initializer: it captures the mount-time
  // snapshot once and is safe to read during render (a ref isn't).
  const [warmAtMount] = useState<Record<Status, boolean>>(() => ({
    WANT: listCache.WANT.loaded,
    WATCHED: listCache.WATCHED.loaded,
  }));
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

  // Seed from localStorage on a cold launch, BEFORE the browser paints.
  //
  // A layout effect rather than the useState initializer above: reading
  // localStorage during render would make the client's first output disagree
  // with the prerendered HTML (a hydration mismatch). A layout effect runs after
  // hydration but before paint, so the skeleton is never actually drawn. A
  // passive effect would work too, but would paint one skeleton frame first.
  //
  // Uses setListsState directly, not setLists: hydrateListCache has already
  // updated the singleton, and going through setLists would persist the data we
  // just read straight back to disk.
  //
  // What this does NOT remove is the wait for JS to download and hydrate, since
  // the static shell's skeleton is what's on screen until then. It removes the
  // API round trip that used to follow hydration, which is what delayed the
  // posters.
  useLayoutEffect(() => {
    if (!hydrateListCache()) return;
    // Seeding React state from an external store on mount has exactly two
    // sanctioned shapes: this, or useSyncExternalStore. The lint rule below
    // objects to cascading renders, and this cascade is one extra render, once
    // per mount, before paint. useSyncExternalStore is the cleaner long-term
    // answer, but it would mean moving all of `lists` into an external store,
    // i.e. rewriting the state machinery the poster-flash fixes live in, for no
    // user-visible gain. Deliberate exception, not an oversight.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setListsState({ ...listCache });
    // Batched with the update above, so this costs no extra render.
    setDiskSeeded(true);
  }, []);

  // Deliberately narrower than `lists`: depending on the whole object would
  // restart the timer below on every fetching/error flag change, which could
  // postpone the skeleton indefinitely during a slow load.
  const activeListLoaded = lists[status].loaded;

  // Start the skeleton's grace period for the active list. Cleared if the status
  // changes or the component unmounts. A stuck skeleton is impossible by
  // construction: the flag only ever *permits* a skeleton, and the render
  // condition also requires the list to still be unloaded, so data arriving
  // during the timeout wins regardless of when the timer fires.
  useEffect(() => {
    if (activeListLoaded || skeletonDelayPassed[status]) return;
    const timer = setTimeout(() => {
      setSkeletonDelayPassed((prev) => (prev[status] ? prev : { ...prev, [status]: true }));
    }, LOADING_DELAY_MS);
    return () => clearTimeout(timer);
  }, [status, activeListLoaded, skeletonDelayPassed]);

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
  const loaded = current.loaded;
  // Every state below now gates on `loaded` explicitly rather than on
  // `!showSkeleton`. Those used to be equivalent, but the skeleton delay
  // introduced a third case (not loaded AND no skeleton yet), and inferring
  // "loaded" from "no skeleton" would render the filtered-empty message during
  // that window.
  const showSkeleton = !loaded && skeletonDelayPassed[status];
  const showError = loaded && current.error && current.titles.length === 0;
  const showEmpty = loaded && !current.error && current.titles.length === 0;
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
  // Rendered even while the list is loading, which it deliberately was not
  // before. The three type chips need no data, so showing the row immediately
  // keeps its ~40px out of the swap: it used to appear only once data landed and
  // shoved the whole grid down. The genre chips still need the Want list, so they
  // append horizontally when it arrives, which scrolls rather than reflows.
  const showFilterRow = status === "WANT" && !showError && !showEmpty;
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
  const showFilteredEmpty = loaded && !showError && !showEmpty && displayTitles.length === 0;
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
      {/* Covers the launch flicker. `ready` is the active list having actually
          loaded, so the splash clears onto real content rather than onto the
          moment the content arrives. Rendered here (the PWA's start_url is "/")
          and present in the server HTML, so it is in the first painted frame. */}
      <LaunchSplash ready={loaded} />
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
          {/* Secondary entry ("Mood"): subdued ghost styling so the solid
              "+ Add" pill stays the primary action. An action, not a list tab.
              Landed in the same commit as /mood itself, so no deployed state
              ever carried a nav entry pointing at a route that didn't exist. */}
          <Link
            href="/mood"
            className="rounded-lg px-3 py-2 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-foreground active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground dark:hover:bg-white/10 dark:active:bg-white/10"
          >
            Mood
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
        /* STRUCTURALLY IDENTICAL to the real grid below, because swapping
           between two differently-sized layouts reflows the page and that reads
           as jitter however fast the swap is. Matched: the mt-2 margin (was
           mt-4, an 8px jump), the column counts, the gap, the tile aspect ratio,
           and critically the two text lines TitleCard renders under each poster,
           which the skeleton used to omit entirely — roughly 40px per row,
           compounding down the grid.
           The placeholder bars use &nbsp; inside the same element as the real
           text, so the line box height comes from the real font metrics rather
           than from a hand-picked pixel height that could drift from them. */
        <div className="mt-2 grid grid-cols-3 gap-3 sm:grid-cols-4" aria-hidden="true">
          {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i}>
              <div className="aspect-[2/3] w-full animate-pulse rounded-lg bg-gray-200 motion-reduce:animate-none dark:bg-white/10" />
              <p className="mt-1 truncate text-sm font-medium">
                <span className="inline-block w-3/4 animate-pulse rounded bg-gray-200 align-middle motion-reduce:animate-none dark:bg-white/10">
                  &nbsp;
                </span>
              </p>
              <p className="mt-0.5 meta">
                <span className="inline-block w-1/2 animate-pulse rounded bg-gray-200 align-middle motion-reduce:animate-none dark:bg-white/10">
                  &nbsp;
                </span>
              </p>
            </div>
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
        <div className={`mt-2 grid grid-cols-3 gap-3 sm:grid-cols-4${warmAtMount[status] || diskSeeded ? "" : " fade-in"}`}>
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
