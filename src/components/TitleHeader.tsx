export function TitleHeader({
  title,
  year,
  posterUrl,
  runtime,
  director,
  genres,
  watchedDate,
}: {
  title: string;
  year: number | null;
  posterUrl: string | null;
  runtime: number | null;
  director: string | null;
  genres: string[];
  watchedDate?: string | null;
}) {
  return (
    <div className="mt-3 flex gap-4">
      <div className="h-48 w-32 flex-shrink-0 overflow-hidden rounded-lg bg-gray-200 ring-1 ring-black/5 dark:bg-white/10 dark:ring-white/10">
        {posterUrl && /* eslint-disable-next-line @next/next/no-img-element */
          <img src={posterUrl} alt={title} className="h-full w-full object-cover" />}
      </div>
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-0.5 meta">
          {year ?? ""}{runtime ? ` · ${runtime} min` : ""}
        </p>
        {watchedDate && <p className="mt-0.5 meta">Watched {watchedDate}</p>}
        {director && (
          <div className="mt-2">
            <p className="meta">Director</p>
            <p className="text-sm">{director}</p>
          </div>
        )}
        <div className="mt-2 flex flex-wrap gap-1">
          {genres.map((g) => (
            <span key={g} className="rounded-full bg-gray-100 px-2 py-0.5 meta dark:bg-white/10">{g}</span>
          ))}
        </div>
      </div>
    </div>
  );
}
