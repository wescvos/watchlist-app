import Link from "next/link";
import type { ResolvedSuggestion } from "@/lib/recommend/types";

// A recommendation tile. The whole card links into the EXISTING preview/add
// flow (/preview/{mediaType}/{tmdbId}) — suggestions are external titles not
// yet in the library, so this is the one-tap path to add one to the Want list.
export function SuggestionCard({ s }: { s: ResolvedSuggestion }) {
  return (
    <Link
      href={`/preview/${s.mediaType.toLowerCase()}/${s.tmdbId}`}
      className="block rounded-lg transition-opacity active:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-gray-200 ring-1 ring-black/5 dark:bg-white/10 dark:ring-white/10">
        {s.posterUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={s.posterUrl} alt={s.title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center p-2 text-center meta">{s.title}</div>
        )}
      </div>
      <p className="mt-1 truncate text-sm font-medium">{s.title}</p>
      <p className="mt-0.5 meta">
        {[s.year, s.mediaType === "TV" ? "TV" : "Movie"].filter((v) => v != null).join(" · ")}
      </p>
      <p className="mt-1 line-clamp-2 text-xs text-gray-500">{s.reason}</p>
    </Link>
  );
}
