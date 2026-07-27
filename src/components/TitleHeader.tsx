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
  spokenLanguages,
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
  spokenLanguages: string[];
  watchedDate?: string | null;
}) {
  const metaParts = [
    year,
    runtime ? `${runtime} min` : null,
    mediaType === "TV" && numberOfSeasons ? `${numberOfSeasons} season${numberOfSeasons === 1 ? "" : "s"}` : null,
    mediaType === "TV" && numberOfEpisodes ? `${numberOfEpisodes} episode${numberOfEpisodes === 1 ? "" : "s"}` : null,
  ].filter((v) => v != null);

  // title + year + media-type hint disambiguates the many films/shows that
  // share a title; filter(Boolean) drops a null year so there's no double space.
  const titleSearchQuery = encodeURIComponent(
    [title, year, mediaType === "MOVIE" ? "movie" : "TV series"].filter(Boolean).join(" "),
  );

  return (
    <div className="relative -mx-4 overflow-hidden">
      {backdropUrl && (
        <div className="absolute inset-0 -z-10 fade-in" aria-hidden="true">
          {/* w780 is ample for a faint ~20%-opacity background (stored URL is w1280). */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={backdropUrl.replace("/w1280/", "/w780/")} alt="" className="h-full w-full object-cover opacity-20 dark:opacity-15" />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-background" />
        </div>
      )}
      <div className="mt-3 flex gap-4 px-4">
        <div className="h-48 w-32 flex-shrink-0 overflow-hidden rounded-lg bg-gray-200 ring-1 ring-black/5 dark:bg-white/10 dark:ring-white/10">
          {/* w342 fits this 128px-wide poster (stored URL is w500). */}
          {posterUrl && /* eslint-disable-next-line @next/next/no-img-element */
            <img src={posterUrl.replace("/w500/", "/w342/")} alt={title} className="h-full w-full object-cover" />}
        </div>
        <div>
          {/* Tappable → Google search for the title, same mechanism as the
              cast links, but no dotted-underline affordance: identical at rest
              (Tailwind preflight resets the anchor's color/underline), with only
              a tap opacity and a keyboard focus ring added. */}
          <h1 className="text-xl font-semibold">
            <a
              href={`https://www.google.com/search?q=${titleSearchQuery}`}
              target="_blank"
              rel="noopener noreferrer"
              className="cursor-pointer rounded transition-opacity active:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
            >
              {title}
            </a>
          </h1>
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
          {spokenLanguages.length > 0 && (
            <div className="mt-2">
              <p className="meta">{spokenLanguages.length === 1 ? "Language" : "Languages"}</p>
              <p className="text-sm">{spokenLanguages.join(", ")}</p>
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
