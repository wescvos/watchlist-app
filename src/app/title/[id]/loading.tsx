// Instant skeleton shown while /title/[id] server-renders — it can block on a
// stale-refresh TMDb/OMDb round-trip, so without this a tap reads as a frozen
// page. Roughly mirrors the detail layout (poster + text + genre pills, a body
// block, a cast row). Same skeleton vocabulary as the home grid; the pulse is
// disabled for reduced-motion (motion-reduce + the global rule in globals.css).
const bar = "animate-pulse bg-gray-200 motion-reduce:animate-none dark:bg-white/10";

export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-2xl p-4 pb-24" aria-hidden="true">
      <div className="-ml-2.5 h-11 w-11" />
      <div className="mt-3 flex gap-4">
        <div className={`h-48 w-32 flex-shrink-0 rounded-lg ${bar}`} />
        <div className="flex-1 space-y-2 pt-1">
          <div className={`h-6 w-3/4 rounded ${bar}`} />
          <div className={`h-3 w-1/2 rounded ${bar}`} />
          <div className={`h-3 w-2/3 rounded ${bar}`} />
          <div className="mt-3 flex gap-1">
            <div className={`h-5 w-14 rounded-full ${bar}`} />
            <div className={`h-5 w-16 rounded-full ${bar}`} />
          </div>
        </div>
      </div>
      <div className="mt-6 space-y-2">
        <div className={`h-3 w-full rounded ${bar}`} />
        <div className={`h-3 w-full rounded ${bar}`} />
        <div className={`h-3 w-4/5 rounded ${bar}`} />
      </div>
      <div className="mt-6 flex gap-4 overflow-hidden">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`h-36 w-24 flex-shrink-0 rounded-lg ${bar}`} />
        ))}
      </div>
    </main>
  );
}
