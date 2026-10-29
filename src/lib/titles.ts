import { prisma } from "@/lib/prisma";
import { fetchMergedTitle, type MergedTitle } from "@/lib/fetchTitle";
import type { MediaKind } from "@/lib/types";
import { Status, type Title, type ListEntry, type MediaType, Prisma } from "@prisma/client";

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
    spokenLanguages: m.spokenLanguages,
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

// Personal fields live on ListEntry. Title still carries legacy copies of
// them until a later release drops those columns, so they are never read.
export type PersonalField =
  | "status"
  | "note"
  | "myRating"
  | "pinned"
  | "pinnedAt"
  | "addedAt"
  | "watchedAt";

// `id` is the Title id, so /title/[id] URLs and client code are unchanged.
export type ListedTitle = Omit<Title, PersonalField> & Pick<ListEntry, PersonalField>;

export type TitlePatch = {
  status?: Status;
  note?: string | null;
  myRating?: number | null;
  pinned?: boolean;
};

// Copy the seven personal fields explicitly rather than spreading the entry:
// a spread would let entry.id (the ListEntry id) clobber the Title id.
function toListed(entry: ListEntry & { title: Title }): ListedTitle {
  const { title: t } = entry;
  return {
    ...t,
    status: entry.status,
    note: entry.note,
    myRating: entry.myRating,
    pinned: entry.pinned,
    pinnedAt: entry.pinnedAt,
    addedAt: entry.addedAt,
    watchedAt: entry.watchedAt,
  };
}

function isNotFound(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2025";
}

export async function addTitle(
  userId: string,
  tmdbId: number,
  mediaType: MediaKind,
  status: Status = Status.WANT,
): Promise<ListedTitle> {
  let title = await prisma.title.findUnique({
    where: { tmdbId_mediaType: { tmdbId, mediaType } },
  });
  if (!title) {
    const merged = await fetchMergedTitle(tmdbId, mediaType);
    // Upsert (not create) so a concurrent add of the same title by another
    // user resolves to the existing row instead of a unique violation.
    title = await prisma.title.upsert({
      where: { tmdbId_mediaType: { tmdbId, mediaType } },
      update: {},
      create: toData(merged),
    });
  }
  const entry = await prisma.listEntry.upsert({
    where: { userId_titleId: { userId, titleId: title.id } },
    // Empty update: re-adding a title you already have leaves it intact.
    update: {},
    create: {
      userId,
      titleId: title.id,
      status,
      watchedAt: status === Status.WATCHED ? new Date() : null,
    },
    include: { title: true },
  });
  return toListed(entry);
}

export async function listTitles(userId: string, status?: Status): Promise<ListedTitle[]> {
  // Watched: most recently watched first (addedAt as tiebreaker).
  // Want / unfiltered: pinned first (most recently pinned on top), then the
  // rest by most recently added. `pinned` is the primary key so pinnedAt's
  // null ordering for unpinned rows never matters: they all fall through to
  // addedAt.
  const orderBy =
    status === Status.WATCHED
      ? [{ watchedAt: "desc" as const }, { addedAt: "desc" as const }]
      : [{ pinned: "desc" as const }, { pinnedAt: "desc" as const }, { addedAt: "desc" as const }];
  const entries = await prisma.listEntry.findMany({
    where: status ? { userId, status } : { userId },
    include: { title: true },
    orderBy,
  });
  return entries.map(toListed);
}

export async function getTitle(userId: string, titleId: string): Promise<ListedTitle | null> {
  const entry = await prisma.listEntry.findUnique({
    where: { userId_titleId: { userId, titleId } },
    include: { title: true },
  });
  return entry ? toListed(entry) : null;
}

export async function updateTitle(
  userId: string,
  titleId: string,
  patch: TitlePatch,
): Promise<ListedTitle | null> {
  const data: Prisma.ListEntryUpdateInput = {};
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
  try {
    const entry = await prisma.listEntry.update({
      where: { userId_titleId: { userId, titleId } },
      data,
      include: { title: true },
    });
    return toListed(entry);
  } catch (e) {
    // P2025: this user has no entry for the title (404, never 403).
    if (isNotFound(e)) return null;
    throw e;
  }
}

export async function refreshTitle(id: string): Promise<Title> {
  const existing = await prisma.title.findUniqueOrThrow({ where: { id } });
  const merged = await fetchMergedTitle(existing.tmdbId, existing.mediaType as MediaKind);
  return prisma.title.update({ where: { id }, data: toData(merged) });
}

export async function getCatalogTitle(
  titleId: string,
): Promise<{ tmdbId: number; mediaType: MediaType } | null> {
  const t = await prisma.title.findUnique({
    where: { id: titleId },
    select: { tmdbId: true, mediaType: true },
  });
  return t ? { tmdbId: t.tmdbId, mediaType: t.mediaType } : null;
}

// Removes only the caller's entry; the shared catalog row is never deleted.
export async function deleteTitle(userId: string, titleId: string): Promise<boolean> {
  const { count } = await prisma.listEntry.deleteMany({ where: { userId, titleId } });
  return count > 0;
}
