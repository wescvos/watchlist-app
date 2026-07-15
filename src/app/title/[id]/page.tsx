import { notFound } from "next/navigation";
import { getTitle, isStale, refreshTitle } from "@/lib/titles";
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
  }
  return <TitleDetail title={JSON.parse(JSON.stringify(title))} />;
}
