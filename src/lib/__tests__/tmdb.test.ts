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

  it("throws when TMDb returns a non-2xx status", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce(new Response("err", { status: 500 }));
    await expect(searchTitles("x")).rejects.toThrow(/failed: 500/);
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

  it("merges details for a TV series (name, first_air_date, episode_run_time)", async () => {
    mockFetchOnce({
      id: 2, name: "Severance", first_air_date: "2022-02-18", poster_path: "/b.jpg",
      overview: "Work.", episode_run_time: [50], vote_average: 8.4,
      genres: [{ name: "Drama" }, { name: "Sci-Fi" }],
      external_ids: { imdb_id: "tt11280740" },
      credits: {
        cast: [{ name: "Adam Scott", character: "Mark" }],
        crew: [{ job: "Director", name: "Ben Stiller" }],
      },
    });
    const out = await getTitleDetails(2, "TV");
    expect(out.title).toBe("Severance");
    expect(out.year).toBe(2022);
    expect(out.runtime).toBe(50);
    expect(out.imdbId).toBe("tt11280740");
    expect(out.genres).toEqual(["Drama", "Sci-Fi"]);
    expect(out.cast[0]).toEqual({ name: "Adam Scott", character: "Mark" });
    expect(out.tmdbScore).toBe(8.4);
  });
});
