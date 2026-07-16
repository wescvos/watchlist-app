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

export default function Home() {
  const [status, setStatus] = useState<Status>("WANT");
  const [reloadToken, setReloadToken] = useState(0);
  const [lists, setLists] = useState<Record<Status, ListState>>({
    WANT: emptyListState,
    WATCHED: emptyListState,
  });
  const skipNextStatusFetch = useRef(true);
  const router = useRouter();

  // Keep the active tab in the URL (replace, not push) so Back from a title
  // detail page restores the tab you were actually on instead of resetting.
  function changeStatus(next: Status) {
    setStatus(next);
    router.replace(next === "WANT" ? "/" : `/?status=${next}`, { scroll: false });
  }
  const handleUrlStatus = useCallback((s: Status) => setStatus(s), []);

  function load(target: Status) {
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
  }

  // Load both lists once so tab counts and the inactive tab's grid are ready before it's opened.
  useEffect(() => {
    const cancels = STATUSES.map((s) => load(s));
    return () => cancels.forEach((cancel) => cancel());
  }, []);

  // Revalidate the active list in the background whenever it's switched to (skip the mount fetch above).
  useEffect(() => {
    if (skipNextStatusFetch.current) {
      skipNextStatusFetch.current = false;
      return;
    }
    return load(status);
  }, [status, reloadToken]);

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
          {current.titles.map((t) => <TitleCard key={t.id} t={t} />)}
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
