import { describe, it, expect, vi } from "vitest";

vi.mock("@/lib/tmdb", () => ({ searchTitles: vi.fn() }));
import { searchTitles } from "@/lib/tmdb";
import { GET } from "@/app/api/search/route";

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
  });
});
