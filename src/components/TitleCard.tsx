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
    <Link href={`/title/${t.id}`} className="block">
      <div className="aspect-[2/3] w-full overflow-hidden rounded-lg bg-gray-200">
        {t.posterUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={t.posterUrl} alt={t.title} className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center p-2 text-center text-xs text-gray-500">
            {t.title}
          </div>
        )}
      </div>
      <p className="mt-1 truncate text-sm font-medium">{t.title}</p>
      <p className="text-xs text-gray-500">
        {t.year ?? ""}{t.myRating != null ? ` · ★ ${t.myRating}/10` : ""}
      </p>
    </Link>
  );
}
