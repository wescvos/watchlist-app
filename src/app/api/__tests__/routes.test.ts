import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("@/lib/tmdb", () => ({ searchTitles: vi.fn() }));
vi.mock("@/lib/titles", () => ({
  updateTitle: vi.fn(),
  deleteTitle: vi.fn(),
  addTitle: vi.fn(),
  listTitles: vi.fn(),
  refreshTitle: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({
  prisma: { title: { findMany: vi.fn().mockResolvedValue([]) } },
}));
vi.mock("@/lib/mood/tagger", () => ({ tagIfUntagged: vi.fn().mockResolvedValue(undefined) }));
// Partial mock: keep the real NextResponse, and make after() run its callback
// immediately WITHOUT awaiting it, which is how the real one behaves relative
// to the response.
vi.mock("next/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("next/server")>();
  return { ...actual, after: vi.fn((cb: () => unknown) => { void cb(); }) };
});

import { after } from "next/server";
import { searchTitles } from "@/lib/tmdb";
import { GET } from "@/app/api/search/route";
import { PATCH } from "@/app/api/titles/[id]/route";
import { POST as addTitleRoute } from "@/app/api/titles/route";
import { POST as refreshRoute } from "@/app/api/titles/[id]/refresh/route";
import { updateTitle, addTitle, refreshTitle } from "@/lib/titles";
import { tagIfUntagged } from "@/lib/mood/tagger";

describe("GET /api/search", () => {
  it("returns 400 without q", async () => {
    const res = await GET(new Request("http://x/api/search"));
    expect(res.status).toBe(400);
  });
  it("returns results for q", async () => {
    (searchTitles as any).mockResolvedValue([{ tmdbId: 1, mediaType: "MOVIE", title: "Dune", year: 2021, posterUrl: null }]);
    const res = await GET(new Request("http://x/api/search?q=dune"));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body[0].title).toBe("Dune");
    expect(body[0].library).toBeNull();
  });
});

function patchReq(body: unknown) {
  return new Request("http://x/api/titles/abc", { method: "PATCH", body: JSON.stringify(body) });
}
const ctx = { params: Promise.resolve({ id: "abc" }) };

describe("PATCH /api/titles/:id validation", () => {
  it("400s on out-of-range myRating and does not call updateTitle", async () => {
    const res = await PATCH(patchReq({ myRating: 11 }), ctx);
    expect(res.status).toBe(400);
    expect(updateTitle).not.toHaveBeenCalled();
  });
  it("400s on myRating of 0 (scale is 1-10, use null to clear)", async () => {
    const res = await PATCH(patchReq({ myRating: 0 }), ctx);
    expect(res.status).toBe(400);
    expect(updateTitle).not.toHaveBeenCalled();
  });
  it("400s on non-integer myRating", async () => {
    const res = await PATCH(patchReq({ myRating: 5.5 }), ctx);
    expect(res.status).toBe(400);
  });
  it("400s on invalid status", async () => {
    const res = await PATCH(patchReq({ status: "bogus" }), ctx);
    expect(res.status).toBe(400);
  });
  it("accepts a valid patch and calls updateTitle", async () => {
    (updateTitle as any).mockResolvedValue({ id: "abc", myRating: 7 });
    const res = await PATCH(patchReq({ myRating: 7 }), ctx);
    expect(res.status).toBe(200);
    expect(updateTitle).toHaveBeenCalledWith("abc", { myRating: 7 });
  });
});

describe("POST /api/titles status validation", () => {
  it("400s on invalid status string", async () => {
    const res = await addTitleRoute(new Request("http://x/api/titles", { method: "POST", body: JSON.stringify({ tmdbId: 1, mediaType: "MOVIE", status: "bogus" }) }));
    expect(res.status).toBe(400);
  });
  it("defaults to WANT when status omitted", async () => {
    (addTitle as any).mockResolvedValue({ id: "x", status: "WANT" });
    const res = await addTitleRoute(new Request("http://x/api/titles", { method: "POST", body: JSON.stringify({ tmdbId: 1, mediaType: "MOVIE" }) }));
    expect(res.status).toBe(200);
    expect(addTitle).toHaveBeenCalledWith(1, "MOVIE", "WANT");
  });
});

describe("mood tagging is scheduled, never awaited", () => {
  const asMock = (fn: unknown) => fn as Mock;

  function addReq(body: unknown) {
    return new Request("http://x/api/titles", { method: "POST", body: JSON.stringify(body) });
  }

  beforeEach(() => {
    vi.clearAllMocks();
    asMock(tagIfUntagged).mockResolvedValue(undefined);
  });

  it("schedules exactly one tagging call for a newly added title", async () => {
    asMock(addTitle).mockResolvedValue({ id: "new-id", status: "WANT" });

    const res = await addTitleRoute(addReq({ tmdbId: 1, mediaType: "MOVIE" }));

    expect(res.status).toBe(200);
    expect(after).toHaveBeenCalledTimes(1);
    expect(tagIfUntagged).toHaveBeenCalledTimes(1);
    expect(tagIfUntagged).toHaveBeenCalledWith("new-id");
  });

  it("returns the add response without waiting for tagging to finish", async () => {
    asMock(addTitle).mockResolvedValue({ id: "new-id", status: "WANT" });
    // Tagging that never settles: the response must still come back.
    asMock(tagIfUntagged).mockReturnValue(new Promise(() => {}));

    const res = await addTitleRoute(addReq({ tmdbId: 1, mediaType: "MOVIE" }));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ id: "new-id" });
  });

  it("does not schedule tagging when the add itself failed", async () => {
    asMock(addTitle).mockRejectedValue(new Error("tmdb down"));

    const res = await addTitleRoute(addReq({ tmdbId: 1, mediaType: "MOVIE" }));

    expect(res.status).toBe(502);
    expect(tagIfUntagged).not.toHaveBeenCalled();
  });

  it("does not schedule tagging for a request rejected by validation", async () => {
    const res = await addTitleRoute(addReq({ tmdbId: 1, mediaType: "PODCAST" }));

    expect(res.status).toBe(400);
    expect(addTitle).not.toHaveBeenCalled();
    expect(tagIfUntagged).not.toHaveBeenCalled();
  });

  it("schedules tagging after a refresh", async () => {
    asMock(refreshTitle).mockResolvedValue({ id: "abc" });

    const res = await refreshRoute(new Request("http://x/api/titles/abc/refresh", { method: "POST" }), ctx);

    expect(res.status).toBe(200);
    expect(tagIfUntagged).toHaveBeenCalledWith("abc");
  });

  it("does not schedule tagging when the refresh failed", async () => {
    asMock(refreshTitle).mockRejectedValue(new Error("tmdb down"));

    const res = await refreshRoute(new Request("http://x/api/titles/abc/refresh", { method: "POST" }), ctx);

    expect(res.status).toBe(502);
    expect(tagIfUntagged).not.toHaveBeenCalled();
  });

  it("a tagging rejection cannot change the response", async () => {
    asMock(addTitle).mockResolvedValue({ id: "new-id", status: "WANT" });
    // tagIfUntagged swallows its own errors, but assert the route survives even
    // if that contract were ever broken.
    asMock(tagIfUntagged).mockRejectedValue(new Error("gemini down"));

    const res = await addTitleRoute(addReq({ tmdbId: 1, mediaType: "MOVIE" }));

    expect(res.status).toBe(200);
  });
});
