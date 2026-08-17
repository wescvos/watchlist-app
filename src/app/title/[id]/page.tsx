import { notFound } from "next/navigation";
import { after } from "next/server";
import { getTitle, isStale, refreshTitle } from "@/lib/titles";
import { tagIfUntagged } from "@/lib/mood/tagger";
import { TitleDetail } from "./TitleDetail";

export default async function TitlePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let title = await getTitle(id);
  if (!title) notFound();
  if (isStale(title.fetchedAt)) {
    try {
      title = await refreshTitle(id);
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
