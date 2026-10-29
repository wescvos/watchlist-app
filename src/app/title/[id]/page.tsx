import { notFound, redirect } from "next/navigation";
import { after } from "next/server";
import { requireUserId } from "@/lib/currentUser";
import { getCatalogTitle, getTitle, isStale, refreshTitle } from "@/lib/titles";
import { tagIfUntagged } from "@/lib/mood/tagger";
import { TitleDetail } from "./TitleDetail";

export default async function TitlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await requireUserId();
  let title = await getTitle(userId, id);
  if (!title) {
    // Not on this user's list. If the catalog knows the title (a link shared by
    // someone else), show the preview where they can add it; otherwise 404.
    // Never a 403: a title id the user has no entry for is simply "not found".
    const catalog = await getCatalogTitle(id);
    if (catalog) redirect(`/preview/${catalog.mediaType.toLowerCase()}/${catalog.tmdbId}`);
    notFound();
  }
  if (isStale(title.fetchedAt)) {
    try {
      await refreshTitle(id);
      // refreshTitle returns the bare catalog row; re-read to keep this user's
      // personal fields on what the page renders.
      title = (await getTitle(userId, id)) ?? title;
    } catch {
      // Keep the cached data if the refresh fails (graceful degradation).
    }
    // Same tagging trigger as the refresh route, scheduled after render so the
    // page never waits on Gemini. Only fires for a title with no moods yet:
    // this path runs automatically for any row older than 30 days, so an
    // ungated call here would let a browsing session spend the daily quota.
    after(() => tagIfUntagged(id));
  }
  return <TitleDetail title={JSON.parse(JSON.stringify(title))} />;
}
