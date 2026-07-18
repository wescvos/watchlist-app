import Link from "next/link";
import type { MediaKind } from "@/lib/types";

export interface CardTitle {
  id: string;
  title: string;
  year: number | null;
  posterUrl: string | null;
  myRating: number | null;
  imdbScore: string | null;
  genres: string[];
  mediaType: MediaKind;
  pinned: boolean;
}

export function TitleCard({ t, status }: { t: CardTitle; status: "WANT" | "WATCHED" }) {
  // Personal rating only exists (and matters) once watched; Want cards show
  // the external IMDb score instead, so the two lists read visibly differently.
  const rating =
    status === "WATCHED" && t.myRating != null ? `★ ${t.myRating}/10`
    : status === "WANT" && t.imdbScore != null ? `IMDb ${t.imdbScore}`
    : null;

  return (
    <Link
      href={`/title/${t.id}`}
      className="block rounded-lg transition-opacity active:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
    >
      <div className="relative aspect-[2/3] w-full overflow-hidden rounded-lg bg-gray-200 ring-1 ring-black/5 dark:bg-white/10 dark:ring-white/10">
        {t.posterUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={t.posterUrl} alt={t.title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center p-2 text-center meta">
            {t.title}
          </div>
        )}
        {t.pinned && (
          <span className="absolute left-1 top-1 rounded bg-background/85 px-1 py-0.5 meta backdrop-blur-sm">Pinned</span>
        )}
      </div>
      <p className="mt-1 truncate text-sm font-medium">{t.title}</p>
      <p className="mt-0.5 meta">
        {[t.year, rating].filter((v) => v != null).join(" ")}
      </p>
    </Link>
  );
}
