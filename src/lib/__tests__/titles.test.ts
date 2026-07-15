import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    title: {
      upsert: vi.fn(),
      update: vi.fn(),
      findMany: vi.fn(),
      findUnique: vi.fn(),
      findUniqueOrThrow: vi.fn(),
      delete: vi.fn(),
    },
  },
}));
vi.mock("@/lib/fetchTitle", () => ({ fetchMergedTitle: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { fetchMergedTitle } from "@/lib/fetchTitle";
import { addTitle, updateTitle, listTitles } from "@/lib/titles";
import { Status } from "@prisma/client";

const merged = {
  tmdbId: 1, mediaType: "MOVIE" as const, imdbId: "tt1", title: "X", year: 2020,
  posterUrl: null, overview: null, runtime: null, genres: [], cast: [], director: null,
  tmdbScore: null, imdbScore: null, rtScore: null, metacriticScore: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  (fetchMergedTitle as any).mockResolvedValue(merged);
  (prisma.title.upsert as any).mockResolvedValue({ id: "x" });
  (prisma.title.update as any).mockResolvedValue({});
  (prisma.title.findMany as any).mockResolvedValue([]);
});

describe("addTitle", () => {
  it("upsert update-branch never touches user fields (preserved on re-add)", async () => {
    await addTitle(1, "MOVIE", Status.WANT);
    const arg = (prisma.title.upsert as any).mock.calls[0][0];
    expect(arg.where).toEqual({ tmdbId_mediaType: { tmdbId: 1, mediaType: "MOVIE" } });
    for (const k of ["status", "note", "myRating", "watchedAt"]) {
      expect(k in arg.update).toBe(false);
    }
  });
  it("create sets WANT with null watchedAt", async () => {
    await addTitle(1, "MOVIE", Status.WANT);
    const arg = (prisma.title.upsert as any).mock.calls[0][0];
    expect(arg.create.status).toBe(Status.WANT);
    expect(arg.create.watchedAt).toBeNull();
  });
  it("create sets WATCHED with a watchedAt date", async () => {
    await addTitle(1, "MOVIE", Status.WATCHED);
    const arg = (prisma.title.upsert as any).mock.calls[0][0];
    expect(arg.create.status).toBe(Status.WATCHED);
    expect(arg.create.watchedAt).toBeInstanceOf(Date);
  });
});

describe("updateTitle", () => {
  it("moving to WATCHED sets watchedAt", async () => {
    await updateTitle("id", { status: Status.WATCHED });
    const arg = (prisma.title.update as any).mock.calls[0][0];
    expect(arg.data.status).toBe(Status.WATCHED);
    expect(arg.data.watchedAt).toBeInstanceOf(Date);
  });
  it("moving to WANT clears watchedAt", async () => {
    await updateTitle("id", { status: Status.WANT });
    const arg = (prisma.title.update as any).mock.calls[0][0];
    expect(arg.data.watchedAt).toBeNull();
  });
  it("updating only note does not touch status/myRating/watchedAt", async () => {
    await updateTitle("id", { note: "hi" });
    const arg = (prisma.title.update as any).mock.calls[0][0];
    expect(arg.data).toEqual({ note: "hi" });
  });
});

describe("listTitles ordering", () => {
  it("WATCHED sorts by watchedAt desc then addedAt desc", async () => {
    await listTitles(Status.WATCHED);
    const arg = (prisma.title.findMany as any).mock.calls[0][0];
    expect(arg.where).toEqual({ status: Status.WATCHED });
    expect(arg.orderBy).toEqual([{ watchedAt: "desc" }, { addedAt: "desc" }]);
  });
  it("WANT sorts by addedAt desc", async () => {
    await listTitles(Status.WANT);
    const arg = (prisma.title.findMany as any).mock.calls[0][0];
    expect(arg.orderBy).toEqual({ addedAt: "desc" });
  });
  it("no filter returns all, addedAt desc", async () => {
    await listTitles();
    const arg = (prisma.title.findMany as any).mock.calls[0][0];
    expect(arg.where).toBeUndefined();
    expect(arg.orderBy).toEqual({ addedAt: "desc" });
  });
});
