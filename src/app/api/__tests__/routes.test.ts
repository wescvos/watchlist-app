import { describe, it, expect, vi } from "vitest";

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

import { searchTitles } from "@/lib/tmdb";
import { GET } from "@/app/api/search/route";
import { PATCH } from "@/app/api/titles/[id]/route";
import { POST as addTitleRoute } from "@/app/api/titles/route";
import { updateTitle, addTitle } from "@/lib/titles";

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
