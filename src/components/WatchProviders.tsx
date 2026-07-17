import type { WatchProvider } from "@/lib/types";

export function WatchProviders({ providers, watchLink }: { providers: WatchProvider[]; watchLink: string | null }) {
  return (
    <div className="mt-4">
      <h2 className="text-sm font-medium">Where to watch</h2>
      {providers.length > 0 ? (
        <div className="mt-2 flex flex-wrap gap-3">
          {providers.map((p) => (
            <div key={p.name} className="flex w-16 flex-col items-center gap-1">
              {p.logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={p.logoUrl} alt={p.name} className="h-10 w-10 rounded-lg object-cover ring-1 ring-black/5 dark:ring-white/10" />
              ) : (
                <div className="h-10 w-10 rounded-lg bg-gray-100 dark:bg-white/10" />
              )}
              <span className="w-full truncate text-center meta">{p.name}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="mt-2 meta">Not on streaming in South Africa</p>
      )}
      {/* JustWatch attribution is required whenever their data is shown, including this "not available" state. */}
      {watchLink ? (
        <a
          href={watchLink}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-block meta underline decoration-dotted underline-offset-2 transition-opacity hover:text-foreground active:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
        >
          Via JustWatch
        </a>
      ) : (
        <p className="mt-2 meta">Via JustWatch</p>
      )}
    </div>
  );
}
