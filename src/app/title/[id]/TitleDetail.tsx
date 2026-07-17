"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BackLink } from "@/components/BackLink";
import { TitleHeader } from "@/components/TitleHeader";
import { ExternalRatings } from "@/components/ExternalRatings";
import { CastCarousel } from "@/components/CastCarousel";
import { WatchProviders } from "@/components/WatchProviders";
import type { CastMember, WatchProvider } from "@/lib/types";

interface Title {
  id: string; title: string; year: number | null; posterUrl: string | null;
  mediaType: "MOVIE" | "TV"; numberOfSeasons: number | null; numberOfEpisodes: number | null;
  overview: string | null; runtime: number | null; genres: string[];
  cast: CastMember[]; director: string | null;
  watchProviders: WatchProvider[]; watchLink: string | null;
  tmdbScore: number | null; imdbScore: string | null; rtScore: string | null; metacriticScore: string | null;
  status: "WANT" | "WATCHED"; note: string | null; myRating: number | null;
  fetchedAt: string; watchedAt: string | null;
}

const RATINGS = Array.from({ length: 10 }, (_, i) => i + 1);

function daysAgo(iso: string): number {
  const ms = Date.now() - new Date(iso).getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

function dataAgeLabel(fetchedAt: string): string {
  const days = daysAgo(fetchedAt);
  if (days === 0) return "Data from today";
  if (days === 1) return "Data from 1 day ago";
  return `Data from ${days} days ago`;
}

function formatWatchedDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

export function TitleDetail({ title }: { title: Title }) {
  const router = useRouter();
  const [status, setStatus] = useState(title.status);
  const [note, setNote] = useState(title.note ?? "");
  const [myRating, setMyRating] = useState<number | null>(title.myRating);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [flash, setFlash] = useState<"rating" | "note" | "refresh" | null>(null);
  const [confirmingRemove, setConfirmingRemove] = useState(false);
  const flashTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const confirmTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (flashTimeout.current) clearTimeout(flashTimeout.current);
      if (confirmTimeout.current) clearTimeout(confirmTimeout.current);
    };
  }, []);

  function showFlash(kind: "rating" | "note" | "refresh") {
    if (flashTimeout.current) clearTimeout(flashTimeout.current);
    setFlash(kind);
    flashTimeout.current = setTimeout(() => setFlash(null), 1500);
  }

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/titles/${title.id}`, { method: "PATCH", body: JSON.stringify(body) });
      if (!res.ok) {
        setError("Couldn't save. Please try again.");
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError("Couldn't save. Please try again.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function rate(n: number) {
    const next = myRating === n ? null : n;
    const prev = myRating;
    setMyRating(next);
    const ok = await patch({ myRating: next });
    if (ok) showFlash("rating");
    else setMyRating(prev);
  }

  async function saveNote() {
    const ok = await patch({ note });
    if (ok) showFlash("note");
  }

  async function toggleStatus() {
    const prev = status;
    const next = status === "WANT" ? "WATCHED" : "WANT";
    setStatus(next);
    const ok = await patch({ status: next });
    if (!ok) setStatus(prev);
  }

  async function refresh() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/titles/${title.id}/refresh`, { method: "POST" });
      if (!res.ok) {
        setError("Refresh failed. Please try again.");
        return;
      }
      router.refresh();
      showFlash("refresh");
    } catch {
      setError("Refresh failed. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    setError("");
    setSaving(true);
    try {
      const res = await fetch(`/api/titles/${title.id}`, { method: "DELETE" });
      if (!res.ok) {
        setError("Couldn't remove. Please try again.");
        return;
      }
      router.push("/");
    } catch {
      setError("Couldn't remove. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  function handleRemoveClick() {
    if (!confirmingRemove) {
      setConfirmingRemove(true);
      confirmTimeout.current = setTimeout(() => setConfirmingRemove(false), 4000);
      return;
    }
    if (confirmTimeout.current) clearTimeout(confirmTimeout.current);
    setConfirmingRemove(false);
    remove();
  }

  const noteDirty = note !== (title.note ?? "");

  return (
    <main className="mx-auto w-full max-w-2xl p-4 pb-24 fade-in">
      <BackLink onClick={() => router.back()} label="Back to watchlist" />

      <TitleHeader
        title={title.title}
        year={title.year}
        posterUrl={title.posterUrl}
        runtime={title.runtime}
        mediaType={title.mediaType}
        numberOfSeasons={title.numberOfSeasons}
        numberOfEpisodes={title.numberOfEpisodes}
        director={title.director}
        genres={title.genres}
        watchedDate={status === "WATCHED" && title.watchedAt ? formatWatchedDate(title.watchedAt) : null}
      />

      {/* Rating only makes sense once watched — prompt to mark it watched instead. */}
      {status === "WANT" && (
        <div className="mt-4 rounded-xl border border-black/10 p-3 text-center dark:border-white/10">
          <p className="text-sm text-gray-500">Rate it once you&rsquo;ve watched it.</p>
          <button
            type="button"
            onClick={toggleStatus}
            disabled={saving}
            className="mt-2 rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
          >
            Mark as watched
          </button>
        </div>
      )}

      {/* My rating — the key personal field. Height+opacity(+small translate)
          reveal on the WANT→WATCHED transition; a CSS transition only fires on
          a value change, not on first paint, so this stays static on load. */}
      <div
        aria-hidden={status !== "WATCHED"}
        inert={status !== "WATCHED"}
        className={`mt-4 grid transition-[grid-template-rows,opacity,transform] ease-out ${
          status === "WATCHED" ? "grid-rows-[1fr] translate-y-0 opacity-100" : "grid-rows-[0fr] translate-y-1 opacity-0"
        }`}
      >
        <div className="overflow-hidden">
          <div className="rounded-xl border border-black/10 p-3 dark:border-white/10">
            <div className="flex items-center justify-between">
              <label className="text-sm font-medium">My rating</label>
              {flash === "rating" && <span className="meta flash-caption">Saved</span>}
            </div>
            <div className="mt-2 grid grid-cols-10 gap-1">
              {RATINGS.map((n) => (
                <button
                  key={n}
                  type="button"
                  onClick={() => rate(n)}
                  disabled={saving}
                  aria-pressed={myRating === n}
                  aria-label={`Rate ${n} out of 10`}
                  className={`flex h-9 items-center justify-center rounded-lg font-mono text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground disabled:opacity-50 ${
                    myRating === n
                      ? "bg-foreground text-background"
                      : "text-gray-500 hover:bg-gray-100 active:bg-gray-100 dark:hover:bg-white/10 dark:active:bg-white/10"
                  }`}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      <ExternalRatings
        tmdbScore={title.tmdbScore}
        imdbScore={title.imdbScore}
        rtScore={title.rtScore}
        metacriticScore={title.metacriticScore}
      />

      <WatchProviders providers={title.watchProviders} watchLink={title.watchLink} />

      {title.overview && <p className="mt-4 text-sm leading-relaxed">{title.overview}</p>}

      <CastCarousel cast={title.cast} />

      {/* Note */}
      <div className="mt-4">
        <label className="text-sm font-medium">Note</label>
        <textarea
          value={note} onChange={(e) => setNote(e.target.value)} rows={3}
          className="mt-1 w-full rounded-lg border border-black/10 bg-gray-50 p-2 text-base focus-visible:border-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground sm:text-sm dark:border-white/10 dark:bg-white/5"
          placeholder="Who recommended it, talking points, thoughts…"
        />
        <div className="mt-1 flex items-center gap-2">
          <button
            onClick={saveNote}
            disabled={saving || !noteDirty}
            className="rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background transition-opacity hover:opacity-90 active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
          >
            Save note
          </button>
          {flash === "note" && <span className="meta flash-caption">Saved</span>}
        </div>
      </div>

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <p className="mt-4 meta">{dataAgeLabel(title.fetchedAt)}</p>

      {/* Actions */}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button
          onClick={toggleStatus}
          disabled={saving}
          className="rounded-lg border border-black/12 px-3 py-2 text-sm transition-colors hover:bg-gray-100 active:bg-gray-100 disabled:opacity-50 dark:border-white/15 dark:hover:bg-white/10 dark:active:bg-white/10"
        >
          {status === "WANT" ? "Mark as watched" : "Move to want to watch"}
        </button>
        <button onClick={refresh} className="rounded-lg border border-black/12 px-3 py-2 text-sm transition-colors hover:bg-gray-100 active:bg-gray-100 disabled:opacity-50 dark:border-white/15 dark:hover:bg-white/10 dark:active:bg-white/10" disabled={saving}>Refresh</button>
        {flash === "refresh" && <span className="meta flash-caption">Updated</span>}
        <button
          onClick={handleRemoveClick}
          disabled={saving}
          className="rounded-lg border border-red-300 px-3 py-2 text-sm text-red-600 transition-colors hover:bg-red-50 active:bg-red-50 disabled:opacity-50 dark:border-red-500/40 dark:text-red-400 dark:hover:bg-red-500/10 dark:active:bg-red-500/10"
        >
          {confirmingRemove ? "Tap again to remove" : "Remove"}
        </button>
      </div>
    </main>
  );
}
