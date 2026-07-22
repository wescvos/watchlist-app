import Link from "next/link";
import type { ResolvedSuggestion } from "@/lib/recommend/types";

// A recommendation tile. The whole card links into the EXISTING preview/add
// flow (/preview/{mediaType}/{tmdbId}) — suggestions are external titles not
// yet in the library, so this is the one-tap path to add one to the Want list.
// When onDismiss is provided, a small "not interested" control overlays the
// poster's top-right corner.
export function SuggestionCard({ s, onDismiss }: { s: ResolvedSuggestion; onDismiss?: (s: ResolvedSuggestion) => void }) {
  return (
    <div className="relative">
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
      {onDismiss && (
        // Sibling of the Link (not nested), so this never triggers navigation
        // and the card tap still opens /preview. 44px hit area in the corner,
        // far from where you tap to open; the visible chip is small and muted.
        <button
          type="button"
          onClick={() => onDismiss(s)}
          aria-label={`Not interested in ${s.title}`}
          className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center focus-visible:outline-none"
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-background/80 text-gray-500 backdrop-blur-sm transition-colors hover:text-foreground active:text-foreground">
            <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </span>
        </button>
      )}
    </div>
  );
}
