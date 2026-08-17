import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { BackLink } from "@/components/BackLink";
import { TitleCard } from "@/components/TitleCard";
import { moodBySlug } from "@/lib/moods";
import type { MediaKind } from "@/lib/types";

// Server component, like the picker: one query, rendered into the HTML. No
// client fetch means no loading state and no remount path, which is also why
// this grid needs no fade-in (see the grid comment below).

export default async function MoodTitlesPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const mood = moodBySlug(slug);
  if (!mood) notFound();

  const titles = await prisma.title.findMany({
    // `has` on a Postgres TEXT[] column. No index needed at this size, and
    // genres is not indexed either; a GIN index is one line if the library ever
    // grows by an order of magnitude.
    where: { status: "WANT", moods: { has: mood.label } },
    // Deliberately the same ordering as listTitles()'s Want branch, so a
    // title's position here feels consistent with Home.
    orderBy: [{ pinned: "desc" }, { pinnedAt: "desc" }, { addedAt: "desc" }],
    select: {
      id: true,
      title: true,
      year: true,
      posterUrl: true,
      myRating: true,
      imdbScore: true,
      genres: true,
      mediaType: true,
      pinned: true,
    },
  });

  return (
    <main className="mx-auto w-full max-w-2xl p-4 pb-24">
      <div className="mb-4 flex items-center gap-2">
        <BackLink href="/mood" label="Back to moods" />
        <h1 className="text-lg font-semibold tracking-tight">{mood.label}</h1>
      </div>

      {titles.length === 0 ? (
        <div className="mt-8 py-8 text-center">
          <p className="font-medium">Nothing here yet</p>
          <p className="mt-1 text-sm text-gray-500">
            Nothing on your Want list feels this way right now.
          </p>
        </div>
      ) : (
        <>
          <p className="meta mb-2">
            {titles.length} {titles.length === 1 ? "title" : "titles"}
          </p>
          {/* Grid classes copied from Home so this reads as the same surface.
              Home's `fade-in` is deliberately NOT copied: there it covers
              client-side hydration of a listCache-warmed list, whereas this
              markup is server-rendered and paints complete on the first frame.
              A fade here would invent the very flash that class exists to hide.
              TitleCard is used unmodified for the same reason its poster is
              eager: adding loading="lazy" is what blanked the grid on
              back-navigation (see its comment). */}
          <div className="mt-2 grid grid-cols-3 gap-3 sm:grid-cols-4">
            {titles.map((t) => (
              <TitleCard
                key={t.id}
                t={{ ...t, mediaType: t.mediaType as MediaKind }}
                status="WANT"
              />
            ))}
          </div>
        </>
      )}
    </main>
  );
}
