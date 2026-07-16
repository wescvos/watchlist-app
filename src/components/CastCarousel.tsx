import type { CastMember } from "@/lib/types";

export function CastCarousel({ cast }: { cast: CastMember[] }) {
  if (cast.length === 0) return null;
  return (
    <div className="mt-4">
      <h2 className="text-sm font-medium">Cast</h2>
      <div className="-mx-4 mt-2 flex snap-x snap-mandatory gap-4 overflow-x-auto touch-pan-x overscroll-x-contain scrollbar-hide px-4 pb-1 [-webkit-overflow-scrolling:touch]">
        {cast.map((c, i) => (
          <div key={i} className="flex w-24 flex-shrink-0 snap-start flex-col items-center">
            <div className="aspect-[2/3] w-24 flex-shrink-0 overflow-hidden rounded-lg bg-gray-200 ring-1 ring-black/5 dark:bg-white/10 dark:ring-white/10">
              {c.profileUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.profileUrl} alt={c.name} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full items-center justify-center p-1 text-center meta">
                  {c.name}
                </div>
              )}
            </div>
            <a
              href={`https://www.google.com/search?q=${encodeURIComponent(c.name)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="mt-1.5 w-full break-words text-center meta underline decoration-dotted underline-offset-2 transition-opacity hover:text-foreground active:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
            >
              {c.name}
            </a>
            {c.character && (
              <p className="w-full truncate text-center text-[11px] text-gray-400 dark:text-gray-500">{c.character}</p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
