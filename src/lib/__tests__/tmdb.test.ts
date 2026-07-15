import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { searchTitles, getTitleDetails } from "@/lib/tmdb";

beforeEach(() => { process.env.TMDB_API_KEY = "k"; });
afterEach(() => { vi.restoreAllMocks(); });

function mockFetchOnce(json: unknown) {
  return vi.spyOn(global, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify(json), { status: 200 }),
  );
}

describe("searchTitles", () => {
  it("maps multi-search movie + tv, skips person", async () => {
    mockFetchOnce({ results: [
      { media_type: "movie", id: 1, title: "Dune", release_date: "2021-10-22", poster_path: "/a.jpg" },
      { media_type: "tv", id: 2, name: "Severance", first_air_date: "2022-02-18", poster_path: null },
      { media_type: "person", id: 3, name: "Someone" },
    ]});
    const out = await searchTitles("x");
    expect(out).toEqual([
      { tmdbId: 1, mediaType: "MOVIE", title: "Dune", year: 2021, posterUrl: "https://image.tmdb.org/t/p/w500/a.jpg" },
      { tmdbId: 2, mediaType: "TV", title: "Severance", year: 2022, posterUrl: null },
    ]);
  });
});

describe("getTitleDetails", () => {
  it("merges details, credits, and external ids for a movie", async () => {
    mockFetchOnce({
      id: 1, title: "Dune", release_date: "2021-10-22", poster_path: "/a.jpg",
      overview: "Sand.", runtime: 155, vote_average: 8.0,
      genres: [{ name: "Sci-Fi" }, { name: "Adventure" }],
      external_ids: { imdb_id: "tt1160419" },
      credits: {
        cast: [{ name: "Timothée", character: "Paul" }, { name: "Zendaya", character: "Chani" }],
        crew: [{ job: "Director", name: "Denis Villeneuve" }],
      },
    });
    const out = await getTitleDetails(1, "MOVIE");
    expect(out.imdbId).toBe("tt1160419");
    expect(out.director).toBe("Denis Villeneuve");
    expect(out.genres).toEqual(["Sci-Fi", "Adventure"]);
    expect(out.cast[0]).toEqual({ name: "Timothée", character: "Paul" });
    expect(out.tmdbScore).toBe(8.0);
    expect(out.runtime).toBe(155);
  });
});
