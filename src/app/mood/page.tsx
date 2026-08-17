import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { BackLink } from "@/components/BackLink";
import { MOODS } from "@/lib/moods";

// Server component on purpose. The whole point of pre-tagging moods is that
// browsing is a database read, so there is no client fetch, no loading state,
// and no cache-warming here. The page arrives complete in the HTML.

// REQUIRED. Without this the build prerenders this page as static (it showed up
// as "○ Static" in the route list), because Prisma is not `fetch` so Next has
// no way to know the data is dynamic. The mood counts would then be frozen at
// build time and never move as titles are added or tagged. Not needed on
// /mood/[slug], which is dynamic by virtue of its params.
export const dynamic = "force-dynamic";

export default async function MoodPage() {
  // ONE query for the whole screen. Counting eleven moods with eleven queries
  // would be eleven round trips for something a 300-row array does in memory.
  const titles = await prisma.title.findMany({
    where: { status: "WANT" },
    select: { moods: true, moodsTaggedAt: true },
  });

  const counts = new Map<string, number>();
  for (const t of titles) {
    for (const m of t.moods) counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  // Tagged-but-matched-nothing is a legitimate result, so "untagged" means
  // never asked, which is what moodsTaggedAt records. Want-only, matching the
  // rest of this screen: the Watched list is not browsable by mood yet, so its
  // untagged titles are not missing from anything here.
  const untagged = titles.filter((t) => t.moodsTaggedAt == null).length;

  return (
    <main className="mx-auto w-full max-w-2xl p-4 pb-24">
      <div className="mb-4 flex items-center gap-2">
        <BackLink href="/" label="Back to watchlist" />
        <h1 className="text-lg font-semibold tracking-tight">Mood</h1>
      </div>

      <p className="meta mb-3">I want something…</p>

      {/* Canonical order, never count order, so the grid does not reshuffle
          between visits and muscle memory keeps working. */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {MOODS.map((mood) => {
          const count = counts.get(mood.label) ?? 0;
          return (
            <Link
              key={mood.slug}
              href={`/mood/${mood.slug}`}
              className={`flex min-h-[4.5rem] flex-col justify-between rounded-lg border border-black/12 p-3 transition-colors hover:bg-gray-100 active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground dark:border-white/15 dark:hover:bg-white/10 dark:active:bg-white/10${
                count === 0 ? " opacity-55" : ""
              }`}
            >
              <span className="text-sm font-medium leading-snug">{mood.label}</span>
              <span className="meta mt-2">{count === 0 ? "none" : count}</span>
            </Link>
          );
        })}
      </div>

      {untagged > 0 && (
        <p className="meta mt-4">
          {untagged} {untagged === 1 ? "title" : "titles"} not yet tagged
        </p>
      )}
    </main>
  );
}
