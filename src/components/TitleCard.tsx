import Link from "next/link";

export interface CardTitle {
  id: string;
  title: string;
  year: number | null;
  posterUrl: string | null;
  myRating: number | null;
}

export function TitleCard({ t }: { t: CardTitle }) {
  return (
    <Link
      href={`/title/${t.id}`}
      className="block rounded-lg transition-opacity active:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
    >
      <div className="aspect-[2/3] w-full overflow-hidden rounded-lg bg-gray-200 ring-1 ring-black/5 dark:bg-white/10 dark:ring-white/10">
        {t.posterUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={t.posterUrl} alt={t.title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center p-2 text-center meta">
            {t.title}
          </div>
        )}
      </div>
      <p className="mt-1 truncate text-sm font-medium">{t.title}</p>
      <p className="mt-0.5 meta">
        {t.year ?? ""}{t.myRating != null ? ` · ★ ${t.myRating}/10` : ""}
      </p>
    </Link>
  );
}
