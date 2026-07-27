// Instant skeleton shown while /preview/[mediaType]/[tmdbId] server-renders —
// this route ALWAYS blocks on a TMDb+OMDb fetch (no DB cache), so the skeleton
// matters most here. Roughly mirrors the preview layout (poster + text, a
// ratings row, a cast row, the add buttons). Same vocabulary as the home grid;
// the pulse is disabled for reduced-motion (motion-reduce + the global rule).
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
      <div className="mt-6 flex gap-3">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`h-12 w-16 rounded-lg ${bar}`} />
        ))}
      </div>
      <div className="mt-6 flex gap-4 overflow-hidden">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className={`h-36 w-24 flex-shrink-0 rounded-lg ${bar}`} />
        ))}
      </div>
      <div className="mt-6 flex gap-2">
        <div className={`h-11 flex-1 rounded-lg ${bar}`} />
        <div className={`h-11 flex-1 rounded-lg ${bar}`} />
      </div>
    </main>
  );
}
