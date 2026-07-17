"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { BackLink } from "@/components/BackLink";
import { TitleHeader } from "@/components/TitleHeader";
import { ExternalRatings } from "@/components/ExternalRatings";
import { CastCarousel } from "@/components/CastCarousel";
import { WatchProviders } from "@/components/WatchProviders";
import type { MergedTitle } from "@/lib/fetchTitle";

export function TitlePreview({ title }: { title: MergedTitle }) {
  const router = useRouter();
  const [adding, setAdding] = useState<"WANT" | "WATCHED" | null>(null);
  const [error, setError] = useState("");

  async function add(status: "WANT" | "WATCHED") {
    setAdding(status);
    setError("");
    try {
      const res = await fetch("/api/titles", {
        method: "POST",
        body: JSON.stringify({ tmdbId: title.tmdbId, mediaType: title.mediaType, status }),
      });
      if (!res.ok) {
        setError(`Couldn't add "${title.title}". Please try again.`);
        return;
      }
      const t = await res.json();
      router.push(`/title/${t.id}`);
    } catch {
      setError(`Couldn't add "${title.title}". Please try again.`);
    } finally {
      setAdding(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-2xl p-4 pb-24 fade-in">
      <BackLink onClick={() => router.back()} label="Back to search" />

      <TitleHeader
        title={title.title}
        year={title.year}
        posterUrl={title.posterUrl}
        backdropUrl={title.backdropUrl}
        tagline={title.tagline}
        runtime={title.runtime}
        mediaType={title.mediaType}
        numberOfSeasons={title.numberOfSeasons}
        numberOfEpisodes={title.numberOfEpisodes}
        director={title.director}
        genres={title.genres}
      />

      <ExternalRatings
        tmdbScore={title.tmdbScore}
        imdbScore={title.imdbScore}
        rtScore={title.rtScore}
        metacriticScore={title.metacriticScore}
      />

      <WatchProviders providers={title.watchProviders} watchLink={title.watchLink} />

      {title.overview && <p className="mt-4 text-sm leading-relaxed">{title.overview}</p>}

      <CastCarousel cast={title.cast} />

      {error && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="mt-6 flex gap-2">
        <button
          onClick={() => add("WANT")}
          disabled={adding !== null}
          className="flex-1 rounded-lg bg-foreground px-3 py-3 text-sm font-medium text-background transition-opacity hover:opacity-90 active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
        >
          {adding === "WANT" ? "Adding…" : "Want"}
        </button>
        <button
          onClick={() => add("WATCHED")}
          disabled={adding !== null}
          className="flex-1 rounded-lg border border-black/12 px-3 py-3 text-sm font-medium transition-colors hover:bg-gray-100 active:bg-gray-100 disabled:opacity-50 dark:border-white/15 dark:hover:bg-white/10 dark:active:bg-white/10"
        >
          {adding === "WATCHED" ? "Adding…" : "Watched"}
        </button>
      </div>
    </main>
  );
}
