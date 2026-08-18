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
 * `imdbScore` is a STRING column ("7.5"), so it is compared as a number.
 * Sorting it lexicographically would rank "9.0" above "10.0", the one case
 * where string order and real order disagree.
 */
function ratingOf(t: PickerTitle): number {
  if (t.imdbScore == null) return -1;
  const n = Number.parseFloat(t.imdbScore);
  return Number.isFinite(n) ? n : -1;
}

/**
 * A TOTAL order over candidates, so nothing depends on the order Postgres
 * happened to return rows in (the query has no ORDER BY, and without one that
 * order is not guaranteed). Rating, then recency, then the URL itself as a
 * final tie-break: arbitrary, but stable.
 */
function compareCandidates(a: PickerTitle, b: PickerTitle): number {
  return (
    ratingOf(b) - ratingOf(a) ||
    b.addedAt.getTime() - a.addedAt.getTime() ||
    a.posterUrl!.localeCompare(b.posterUrl!)
  );
}

/**
 * Assign one background poster per mood, with NO TITLE USED TWICE.
 *
 * Picking each mood's best title independently produced visible collisions:
 * multi-tagging means one title can be the highest-rated in several moods at
 * once, so "Light & funny" and "Feel-good" ended up showing the same image.
 * That is the tagging working correctly and the pick being unconstrained, so the
 * fix belongs here.
 *
 * SCARCEST MOOD FIRST. Moods are processed in ascending order of how many Want
 * titles they have, so a mood with 28 candidates gets first refusal before one
 * with 105 can strip its only options. (Ordering uses the mood's full count,
 * the same number the tile displays, which makes the behaviour explainable;
 * counting only titles that have posters would give a near-identical order.)
 * Count ties break on canonical mood order, so the whole assignment is
 * deterministic: the same rows always produce the same tiles.
 */
function assignPosters(titles: PickerTitle[], counts: Map<string, number>): Map<string, string> {
  const candidates = new Map<string, PickerTitle[]>();
  for (const mood of MOODS) {
    const list = titles.filter((t) => t.moods.includes(mood.label) && t.posterUrl);
    list.sort(compareCandidates);
    candidates.set(mood.label, list);
  }

  const order = MOODS.map((mood, index) => ({
    label: mood.label,
    count: counts.get(mood.label) ?? 0,
    index,
  }))
    // A mood with no titles keeps the plain dash tile, so it takes no poster.
    .filter((m) => m.count > 0)
    .sort((a, b) => a.count - b.count || a.index - b.index);

  const used = new Set<string>();
  const chosen = new Map<string, string>();

  for (const { label } of order) {
    const list = candidates.get(label) ?? [];
    // Highest-rated unused title. If every candidate is already spoken for,
    // reuse the top one rather than leaving a hole: a duplicate reads better
    // than a blank tile. With 327 titles across 12 moods this should never
    // fire, but it cannot be allowed to produce an empty tile.
    const pick = list.find((t) => !used.has(t.posterUrl!)) ?? list[0];
    if (!pick?.posterUrl) continue;
    used.add(pick.posterUrl);
    // w342 for a ~170px tile at 2x (stored URL is w500), same size-swap trick
    // the cards use.
    chosen.set(label, pick.posterUrl.replace("/w500/", "/w342/"));
  }

  return chosen;
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
  // Computed once for the whole grid, because the assignment is global: which
  // poster a tile gets depends on what the other tiles took.
  const posters = assignPosters(titles, counts);

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
          const poster = posters.get(mood.label) ?? null;
          return (
            <Link
              key={mood.slug}
              href={`/mood/${mood.slug}`}
              // The visual tile reads "Dark & heavy" above a bare "102", which a
              // screen reader announces as "Dark & heavy 102" with no unit, and
              // for an empty mood as the label followed by a stray dash. An
              // explicit name replaces both with something meaningful. The tap
              // target is the whole tile (min-h 5.5rem, well over the 44px
              // minimum) and the focus ring is the codebase's standard
              // focus-visible:ring-foreground, both already on the className below.
              aria-label={
                count === 0
                  ? `${mood.label}, no titles`
                  : `${mood.label}, ${count} ${count === 1 ? "title" : "titles"}`
              }
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
                {count === 0 ? (
                  <span aria-hidden="true" className="text-gray-400 dark:text-gray-500">
                    –
                  </span>
                ) : (
                  count
                )}
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
