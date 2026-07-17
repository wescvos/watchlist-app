export function TitleHeader({
  title,
  year,
  posterUrl,
  backdropUrl,
  tagline,
  runtime,
  mediaType,
  numberOfSeasons,
  numberOfEpisodes,
  director,
  genres,
  watchedDate,
}: {
  title: string;
  year: number | null;
  posterUrl: string | null;
  backdropUrl: string | null;
  tagline: string | null;
  runtime: number | null;
  mediaType: "MOVIE" | "TV";
  numberOfSeasons: number | null;
  numberOfEpisodes: number | null;
  director: string | null;
  genres: string[];
  watchedDate?: string | null;
}) {
  const metaParts = [
    year,
    runtime ? `${runtime} min` : null,
    mediaType === "TV" && numberOfSeasons ? `${numberOfSeasons} season${numberOfSeasons === 1 ? "" : "s"}` : null,
    mediaType === "TV" && numberOfEpisodes ? `${numberOfEpisodes} episode${numberOfEpisodes === 1 ? "" : "s"}` : null,
  ].filter((v) => v != null);

  return (
    <div className="relative -mx-4 overflow-hidden">
      {backdropUrl && (
        <div className="absolute inset-0 -z-10 fade-in" aria-hidden="true">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={backdropUrl} alt="" className="h-full w-full object-cover opacity-20 dark:opacity-15" />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-background" />
        </div>
      )}
      <div className="mt-3 flex gap-4 px-4">
        <div className="h-48 w-32 flex-shrink-0 overflow-hidden rounded-lg bg-gray-200 ring-1 ring-black/5 dark:bg-white/10 dark:ring-white/10">
          {posterUrl && /* eslint-disable-next-line @next/next/no-img-element */
            <img src={posterUrl} alt={title} className="h-full w-full object-cover" />}
        </div>
        <div>
          <h1 className="text-xl font-semibold">{title}</h1>
          <p className="mt-0.5 meta">
            {metaParts.join(" ")}
          </p>
          {tagline && <p className="mt-1 meta">{tagline}</p>}
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
    </div>
  );
}
