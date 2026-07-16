import { notFound } from "next/navigation";
import { fetchMergedTitle, type MergedTitle } from "@/lib/fetchTitle";
import { TitlePreview } from "./TitlePreview";

export default async function PreviewPage({
  params,
}: {
  params: Promise<{ mediaType: string; tmdbId: string }>;
}) {
  const { mediaType: rawMediaType, tmdbId: rawTmdbId } = await params;
  const mediaType = rawMediaType.toUpperCase();
  const tmdbId = Number(rawTmdbId);
  if ((mediaType !== "MOVIE" && mediaType !== "TV") || !Number.isInteger(tmdbId)) notFound();

  let merged: MergedTitle;
  try {
    merged = await fetchMergedTitle(tmdbId, mediaType);
  } catch {
    notFound();
  }

  return <TitlePreview title={JSON.parse(JSON.stringify(merged))} />;
}
