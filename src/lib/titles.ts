import { prisma } from "@/lib/prisma";
import { fetchMergedTitle, type MergedTitle } from "@/lib/fetchTitle";
import type { MediaKind } from "@/lib/types";
import { Status, type Title, Prisma } from "@prisma/client";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export function isStale(fetchedAt: Date, now: Date = new Date()): boolean {
  return now.getTime() - fetchedAt.getTime() > THIRTY_DAYS_MS;
}

function toData(m: MergedTitle) {
  return {
    tmdbId: m.tmdbId,
    mediaType: m.mediaType,
    imdbId: m.imdbId,
    title: m.title,
    year: m.year,
    posterUrl: m.posterUrl,
    backdropUrl: m.backdropUrl,
    overview: m.overview,
    tagline: m.tagline,
    runtime: m.runtime,
    numberOfSeasons: m.numberOfSeasons,
    numberOfEpisodes: m.numberOfEpisodes,
    genres: m.genres,
    cast: m.cast as unknown as Prisma.InputJsonValue,
    director: m.director,
    watchProviders: m.watchProviders as unknown as Prisma.InputJsonValue,
    watchLink: m.watchLink,
    tmdbScore: m.tmdbScore,
    imdbScore: m.imdbScore,
    rtScore: m.rtScore,
    metacriticScore: m.metacriticScore,
    fetchedAt: new Date(),
  };
}

export async function addTitle(
  tmdbId: number,
  mediaType: MediaKind,
  status: Status = Status.WANT,
): Promise<Title> {
  const merged = await fetchMergedTitle(tmdbId, mediaType);
  const data = toData(merged);
  return prisma.title.upsert({
    where: { tmdbId_mediaType: { tmdbId, mediaType } },
    // Re-adding refreshes cached metadata only; user fields
    // (status/note/myRating/watchedAt) are left untouched.
    update: data,
    create: {
      ...data,
      status,
      watchedAt: status === Status.WATCHED ? new Date() : null,
    },
  });
}

export function listTitles(status?: Status): Promise<Title[]> {
  // Watched: most recently watched first (addedAt as tiebreaker).
  // Want / unfiltered: pinned first (most recently pinned on top), then the
  // rest by most recently added. `pinned` is the primary key so pinnedAt's
  // null ordering for unpinned rows never matters — they all fall through to
  // addedAt.
  const orderBy =
    status === Status.WATCHED
      ? [{ watchedAt: "desc" as const }, { addedAt: "desc" as const }]
      : [{ pinned: "desc" as const }, { pinnedAt: "desc" as const }, { addedAt: "desc" as const }];
  return prisma.title.findMany({
    where: status ? { status } : undefined,
    orderBy,
  });
}

export function getTitle(id: string): Promise<Title | null> {
  return prisma.title.findUnique({ where: { id } });
}

export async function updateTitle(
  id: string,
  patch: { status?: Status; note?: string | null; myRating?: number | null; pinned?: boolean },
): Promise<Title> {
  const data: Prisma.TitleUpdateInput = {};
  if (patch.note !== undefined) data.note = patch.note;
  if (patch.myRating !== undefined) data.myRating = patch.myRating;
  if (patch.pinned !== undefined) {
    data.pinned = patch.pinned;
    data.pinnedAt = patch.pinned ? new Date() : null;
  }
  // Applied after the pinned branch so that a combined status→WATCHED wins:
  // pinning is a want-list concept, so a watched title must never stay pinned.
  if (patch.status !== undefined) {
    data.status = patch.status;
    data.watchedAt = patch.status === Status.WATCHED ? new Date() : null;
    if (patch.status === Status.WATCHED) {
      data.pinned = false;
      data.pinnedAt = null;
    }
  }
  return prisma.title.update({ where: { id }, data });
}

export async function refreshTitle(id: string): Promise<Title> {
  const existing = await prisma.title.findUniqueOrThrow({ where: { id } });
  const merged = await fetchMergedTitle(existing.tmdbId, existing.mediaType as MediaKind);
  return prisma.title.update({ where: { id }, data: toData(merged) });
}

export async function deleteTitle(id: string): Promise<void> {
  await prisma.title.delete({ where: { id } });
}
