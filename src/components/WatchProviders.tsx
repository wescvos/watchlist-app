import type { WatchProvider } from "@/lib/types";

// Note: JustWatch's terms technically require attribution ("Via JustWatch")
// whenever their provider data is shown — omitted here only because this is
// a private single-user app. Restore it if this ever becomes public/multi-user.
export function WatchProviders({ providers }: { providers: WatchProvider[] }) {
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
    </div>
  );
}
