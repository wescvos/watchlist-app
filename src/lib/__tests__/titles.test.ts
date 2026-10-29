import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    title: {
      upsert: vi.fn(),
      update: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      delete: vi.fn(),
    },
    listEntry: {
      upsert: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      deleteMany: vi.fn(),
    },
  },
}));
vi.mock("@/lib/fetchTitle", () => ({ fetchMergedTitle: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { fetchMergedTitle } from "@/lib/fetchTitle";
import {
  addTitle,
  updateTitle,
  listTitles,
  getTitle,
  deleteTitle,
  getCatalogTitle,
} from "@/lib/titles";
import { Status } from "@prisma/client";

const merged = {
  tmdbId: 1, mediaType: "MOVIE" as const, imdbId: "tt1", title: "X", year: 2020,
  posterUrl: null, overview: null, runtime: null, genres: [], cast: [], director: null,
  tmdbScore: null, imdbScore: null, rtScore: null, metacriticScore: null,
};

// The catalog row still carries its legacy personal columns until a later
// release; the ListedTitle must ignore them and use the entry's values.
const titleRow = {
  id: "t1", tmdbId: 1, mediaType: "MOVIE", title: "X",
  status: "WATCHED", note: "legacy", myRating: 1, pinned: true,
  pinnedAt: new Date(1), addedAt: new Date(2), watchedAt: new Date(3),
};
const entryRow = {
  id: "e1", userId: "u1", titleId: "t1",
  status: "WANT", note: "mine", myRating: 8, pinned: false,
  pinnedAt: null, addedAt: new Date(10), watchedAt: null,
  title: titleRow,
};

const mocked = <T>(f: T) => f as unknown as ReturnType<typeof vi.fn>;

beforeEach(() => {
  vi.clearAllMocks();
  mocked(fetchMergedTitle).mockResolvedValue(merged);
  mocked(prisma.title.findUnique).mockResolvedValue(titleRow);
  mocked(prisma.title.upsert).mockResolvedValue(titleRow);
  mocked(prisma.listEntry.upsert).mockResolvedValue(entryRow);
  mocked(prisma.listEntry.update).mockResolvedValue(entryRow);
  mocked(prisma.listEntry.findMany).mockResolvedValue([]);
  mocked(prisma.listEntry.findUnique).mockResolvedValue(entryRow);
  mocked(prisma.listEntry.deleteMany).mockResolvedValue({ count: 1 });
});

describe("addTitle", () => {
  it("existing catalog row: no fetch, upserts the entry with an empty update", async () => {
    await addTitle("u1", 1, "MOVIE", Status.WANT);
    expect(fetchMergedTitle).not.toHaveBeenCalled();
    expect(prisma.title.upsert).not.toHaveBeenCalled();
    const arg = mocked(prisma.listEntry.upsert).mock.calls[0][0];
    expect(arg.where).toEqual({ userId_titleId: { userId: "u1", titleId: "t1" } });
    // Empty update: re-adding your own title leaves it intact.
    expect(arg.update).toEqual({});
    expect(arg.create).toEqual({ userId: "u1", titleId: "t1", status: Status.WANT, watchedAt: null });
  });
  it("missing catalog row: fetches, upserts the title, then creates the entry", async () => {
    mocked(prisma.title.findUnique).mockResolvedValue(null);
    await addTitle("u1", 1, "MOVIE", Status.WANT);
    expect(fetchMergedTitle).toHaveBeenCalledWith(1, "MOVIE");
    const t = mocked(prisma.title.upsert).mock.calls[0][0];
    expect(t.where).toEqual({ tmdbId_mediaType: { tmdbId: 1, mediaType: "MOVIE" } });
    for (const k of ["status", "note", "myRating", "pinned", "pinnedAt", "addedAt", "watchedAt"]) {
      expect(k in t.create).toBe(false);
    }
    expect(prisma.listEntry.upsert).toHaveBeenCalledTimes(1);
  });
  it("WATCHED sets watchedAt on the entry", async () => {
    await addTitle("u1", 1, "MOVIE", Status.WATCHED);
    const arg = mocked(prisma.listEntry.upsert).mock.calls[0][0];
    expect(arg.create.status).toBe(Status.WATCHED);
    expect(arg.create.watchedAt).toBeInstanceOf(Date);
  });
  it("result id is the title id and personal fields come from the entry", async () => {
    const r = await addTitle("u1", 1, "MOVIE");
    expect(r.id).toBe("t1");
    expect(r.title).toBe("X");
    expect(r.status).toBe("WANT");
    expect(r.note).toBe("mine");
    expect(r.myRating).toBe(8);
    expect(r.pinned).toBe(false);
    expect(r.watchedAt).toBeNull();
    expect(r.addedAt).toEqual(new Date(10));
  });
});

describe("updateTitle", () => {
  const where = { userId_titleId: { userId: "u1", titleId: "t1" } };
  const data = () => mocked(prisma.listEntry.update).mock.calls[0][0].data;

  it("targets the user's entry and returns the listed title", async () => {
    const r = await updateTitle("u1", "t1", { note: "hi" });
    expect(mocked(prisma.listEntry.update).mock.calls[0][0].where).toEqual(where);
    expect(r?.id).toBe("t1");
  });
  it("moving to WATCHED sets watchedAt", async () => {
    await updateTitle("u1", "t1", { status: Status.WATCHED });
    expect(data().status).toBe(Status.WATCHED);
    expect(data().watchedAt).toBeInstanceOf(Date);
  });
  it("moving to WANT clears watchedAt", async () => {
    await updateTitle("u1", "t1", { status: Status.WANT });
    expect(data().watchedAt).toBeNull();
  });
  it("updating only note does not touch anything else", async () => {
    await updateTitle("u1", "t1", { note: "hi" });
    expect(data()).toEqual({ note: "hi" });
  });
  it("pinning sets pinned true and a pinnedAt date, touching nothing else", async () => {
    await updateTitle("u1", "t1", { pinned: true });
    expect(data().pinned).toBe(true);
    expect(data().pinnedAt).toBeInstanceOf(Date);
    for (const k of ["status", "note", "myRating", "watchedAt"]) {
      expect(k in data()).toBe(false);
    }
  });
  it("unpinning sets pinned false and nulls pinnedAt", async () => {
    await updateTitle("u1", "t1", { pinned: false });
    expect(data().pinned).toBe(false);
    expect(data().pinnedAt).toBeNull();
  });
  it("marking WATCHED clears pinned/pinnedAt (pinning is want-only)", async () => {
    await updateTitle("u1", "t1", { status: Status.WATCHED });
    expect(data().pinned).toBe(false);
    expect(data().pinnedAt).toBeNull();
  });
  it("a combined pin + mark-WATCHED patch lets WATCHED win", async () => {
    await updateTitle("u1", "t1", { pinned: true, status: Status.WATCHED });
    expect(data().pinned).toBe(false);
    expect(data().pinnedAt).toBeNull();
  });
  it("returns null when the user has no entry (P2025)", async () => {
    const { Prisma } = await import("@prisma/client");
    mocked(prisma.listEntry.update).mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError("missing", { code: "P2025", clientVersion: "x" }),
    );
    expect(await updateTitle("u1", "t1", { note: "hi" })).toBeNull();
  });
  it("rethrows other errors", async () => {
    mocked(prisma.listEntry.update).mockRejectedValue(new Error("boom"));
    await expect(updateTitle("u1", "t1", { note: "hi" })).rejects.toThrow("boom");
  });
});

describe("listTitles", () => {
  it("WATCHED filters by user and sorts by watchedAt desc then addedAt desc", async () => {
    await listTitles("u1", Status.WATCHED);
    const arg = mocked(prisma.listEntry.findMany).mock.calls[0][0];
    expect(arg.where).toEqual({ userId: "u1", status: "WATCHED" });
    expect(arg.include).toEqual({ title: true });
    expect(arg.orderBy).toEqual([{ watchedAt: "desc" }, { addedAt: "desc" }]);
  });
  it("WANT sorts pinned first (newest pin), then by addedAt desc", async () => {
    await listTitles("u1", Status.WANT);
    const arg = mocked(prisma.listEntry.findMany).mock.calls[0][0];
    expect(arg.where).toEqual({ userId: "u1", status: "WANT" });
    expect(arg.orderBy).toEqual([{ pinned: "desc" }, { pinnedAt: "desc" }, { addedAt: "desc" }]);
  });
  it("no status filter scopes to the user only, with pinned-first ordering", async () => {
    await listTitles("u1");
    const arg = mocked(prisma.listEntry.findMany).mock.calls[0][0];
    expect(arg.where).toEqual({ userId: "u1" });
    expect(arg.orderBy).toEqual([{ pinned: "desc" }, { pinnedAt: "desc" }, { addedAt: "desc" }]);
  });
  it("maps entries to listed titles keyed by title id", async () => {
    mocked(prisma.listEntry.findMany).mockResolvedValue([entryRow]);
    const [r] = await listTitles("u1");
    expect(r.id).toBe("t1");
    expect(r.note).toBe("mine");
  });
});

describe("getTitle", () => {
  it("looks up by user and title id", async () => {
    const r = await getTitle("u1", "t1");
    const arg = mocked(prisma.listEntry.findUnique).mock.calls[0][0];
    expect(arg.where).toEqual({ userId_titleId: { userId: "u1", titleId: "t1" } });
    expect(r?.id).toBe("t1");
    expect(r?.note).toBe("mine");
  });
  it("returns null when the user has no entry", async () => {
    mocked(prisma.listEntry.findUnique).mockResolvedValue(null);
    expect(await getTitle("u2", "t1")).toBeNull();
  });
});

describe("deleteTitle", () => {
  it("deletes only the user's entry and reports true", async () => {
    expect(await deleteTitle("u1", "t1")).toBe(true);
    expect(mocked(prisma.listEntry.deleteMany).mock.calls[0][0]).toEqual({
      where: { userId: "u1", titleId: "t1" },
    });
    expect(prisma.title.delete).not.toHaveBeenCalled();
  });
  it("reports false when there was no entry", async () => {
    mocked(prisma.listEntry.deleteMany).mockResolvedValue({ count: 0 });
    expect(await deleteTitle("u1", "t1")).toBe(false);
    expect(prisma.title.delete).not.toHaveBeenCalled();
  });
});

describe("getCatalogTitle", () => {
  it("returns tmdbId and mediaType, or null", async () => {
    expect(await getCatalogTitle("t1")).toEqual({ tmdbId: 1, mediaType: "MOVIE" });
    mocked(prisma.title.findUnique).mockResolvedValue(null);
    expect(await getCatalogTitle("nope")).toBeNull();
  });
});
