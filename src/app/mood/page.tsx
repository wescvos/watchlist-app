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

/** One Want title, as the picker's single query selects it. */
interface PickerTitle {
  moods: string[];
  moodsTaggedAt: Date | null;
  posterUrl: string | null;
  imdbScore: string | null;
  addedAt: Date;
}

/**
 * The poster that represents a mood: its highest-rated title, falling back to
 * the most recently added when ratings tie or are missing.
 *
 * DETERMINISTIC BY DESIGN. A tile that reshuffles between visits is noise rather
 * than delight, so this is a total order over the mood's titles with no
 * randomness and no dependence on query order.
 *
 * `imdbScore` is a STRING column ("7.5"), so it is compared as a number here.
 * Sorting it lexicographically would rank "9.0" above "10.0", which is the one
 * case where the string order and the real order disagree.
 */
function ratingOf(t: PickerTitle): number {
  if (t.imdbScore == null) return -1;
  const n = Number.parseFloat(t.imdbScore);
  return Number.isFinite(n) ? n : -1;
}

function posterFor(titles: PickerTitle[], mood: string): string | null {
  const candidates = titles.filter((t) => t.moods.includes(mood) && t.posterUrl);

  // A TOTAL order, so the result cannot depend on the order Postgres happened
  // to return rows in (the query has no ORDER BY, and without one that order is
  // not guaranteed). Rating, then recency, then the URL itself as a final
  // tie-break, which is arbitrary but stable.
  candidates.sort(
    (a, b) =>
      ratingOf(b) - ratingOf(a) ||
      b.addedAt.getTime() - a.addedAt.getTime() ||
      a.posterUrl!.localeCompare(b.posterUrl!),
  );

  // w342 for a ~170px tile at 2x (stored URL is w500), same size-swap trick the
  // cards use.
  return candidates[0]?.posterUrl?.replace("/w500/", "/w342/") ?? null;
}

export default async function MoodPage() {
  // STILL ONE QUERY for the whole screen, now carrying what the poster pick
  // needs too. Counting twelve moods and choosing twelve posters with per-mood
  // queries would be two dozen round trips for something a 300-row array does
  // in memory.
  const titles: PickerTitle[] = await prisma.title.findMany({
    where: { status: "WANT" },
    select: {
      moods: true,
      moodsTaggedAt: true,
      posterUrl: true,
      imdbScore: true,
      addedAt: true,
    },
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
          const poster = count > 0 ? posterFor(titles, mood.label) : null;
          return (
            <Link
              key={mood.slug}
              href={`/mood/${mood.slug}`}
              className={`relative flex min-h-[5.5rem] flex-col justify-between overflow-hidden rounded-lg border border-black/12 p-3 transition-colors hover:bg-gray-100 active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground dark:border-white/15 dark:hover:bg-white/10 dark:active:bg-white/10${
                count === 0 ? " opacity-55" : ""
              }`}
            >
              {poster && (
                <div aria-hidden="true" className="absolute inset-0">
                  {/* Full brightness image plus ONE uniform scrim, the same
                      technique as the search poster wall: per-image opacity
                      made that wall patchy, because bright posters popped while
                      dark ones vanished. A single flat overlay mutes every
                      poster by the same amount, so the label and count stay
                      legible whatever the artwork looks like.
                      No loading="lazy" here, matching TitleCard: lazy is what
                      blanked grids on back-navigation, and twelve small
                      above-the-fold images are fine eager. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={poster} alt="" className="h-full w-full object-cover" />
                  <div className="absolute inset-0 bg-background/80" />
                  {/* Weights the lower half, where the numeral sits. */}
                  <div className="absolute inset-0 bg-gradient-to-t from-background/70 to-transparent" />
                </div>
              )}
              {/* `relative` so the text paints above the absolutely-positioned
                  backdrop, which would otherwise cover in-flow content. */}
              <span className="relative text-sm font-medium leading-snug">{mood.label}</span>
              {/* Editorial stat block: label as the heading, the number as the
                  visual weight. Large and light rather than small and grey, in
                  the app's mono voice, tabular so the twelve tiles align. */}
              <span className="relative mt-2 self-end font-mono text-3xl font-light leading-none tabular-nums">
                {/* An empty category reads as a quiet dash. "NONE" looked like
                    an error rather than an empty shelf. The dash keeps the
                    baseline rhythm across all twelve tiles. */}
                {count === 0 ? <span className="text-gray-400 dark:text-gray-500">–</span> : count}
              </span>
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
