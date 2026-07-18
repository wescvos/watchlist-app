import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { searchTitles, getTitleDetails, relaxationCandidates } from "@/lib/tmdb";

beforeEach(() => { process.env.TMDB_API_KEY = "k"; });
afterEach(() => { vi.restoreAllMocks(); });

function mockFetchOnce(json: unknown) {
  return vi.spyOn(global, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify(json), { status: 200 }),
  );
}

// Responds based on the `query` param TMDb receives, so tests can assert both
// which relaxed query finally matched and how many calls it took.
function mockFetchByQuery(resultsFor: (query: string) => unknown[]) {
  return vi.spyOn(global, "fetch").mockImplementation(async (input: RequestInfo | URL) => {
    const query = new URL(String(input)).searchParams.get("query") ?? "";
    return new Response(JSON.stringify({ results: resultsFor(query) }), { status: 200 });
  });
}

const MOVIE = { media_type: "movie", id: 1, title: "Inception", release_date: "2010-07-15", poster_path: "/a.jpg", popularity: 50, vote_count: 100 };
const TV = { media_type: "tv", id: 2, name: "The Expanse", first_air_date: "2015-12-14", poster_path: null };

describe("searchTitles", () => {
  it("maps multi-search movie + tv, skips person", async () => {
    mockFetchOnce({ results: [
      { media_type: "movie", id: 1, title: "Dune", release_date: "2021-10-22", poster_path: "/a.jpg", popularity: 123.4, vote_count: 9000 },
      { media_type: "tv", id: 2, name: "Severance", first_air_date: "2022-02-18", poster_path: null },
      { media_type: "person", id: 3, name: "Someone" },
    ]});
    const out = await searchTitles("x");
    expect(out).toEqual([
      { tmdbId: 1, mediaType: "MOVIE", title: "Dune", year: 2021, posterUrl: "https://image.tmdb.org/t/p/w500/a.jpg", popularity: 123.4, voteCount: 9000 },
      { tmdbId: 2, mediaType: "TV", title: "Severance", year: 2022, posterUrl: null, popularity: 0, voteCount: 0 },
    ]);
  });

  it("retries once on a retryable status and succeeds", async () => {
    const fetchSpy = vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(new Response("err", { status: 502 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ results: [] }), { status: 200 }));
    const out = await searchTitles("x");
    expect(out).toEqual([]);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting retries on a persistent retryable status", async () => {
    const fetchSpy = vi.spyOn(global, "fetch")
      .mockResolvedValueOnce(new Response("err", { status: 500 }))
      .mockResolvedValueOnce(new Response("err", { status: 500 }));
    await expect(searchTitles("x")).rejects.toThrow(/failed: 500/);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("does not retry a non-retryable status", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValueOnce(new Response("err", { status: 404 }));
    await expect(searchTitles("x")).rejects.toThrow(/failed: 404/);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("rescues a zero-result query by dropping a trailing word", async () => {
    const fetchSpy = mockFetchByQuery((q) => (q === "inception" ? [MOVIE] : []));
    const out = await searchTitles("inception dreams");
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("Inception");
    // "inception dreams" (empty) then "inception" (hit) — exactly two calls.
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("rescues a zero-result query by dropping a leading article", async () => {
    const fetchSpy = mockFetchByQuery((q) => (q === "expanse" ? [TV] : []));
    const out = await searchTitles("the expanse");
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("The Expanse");
    // "the expanse" (empty), "the" (empty), then article-stripped "expanse" (hit).
    expect(fetchSpy).toHaveBeenCalledTimes(3);
  });

  it("does NOT run any relaxation when the first query already has results", async () => {
    // Multi-word query so relaxation candidates exist — none must be tried.
    const fetchSpy = mockFetchByQuery((q) => (q === "the batman" ? [MOVIE] : []));
    const out = await searchTitles("the batman");
    expect(out).toHaveLength(1);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("gives up and returns empty when nothing matches, capping the calls", async () => {
    const fetchSpy = mockFetchByQuery(() => []);
    const out = await searchTitles("the batman begins");
    expect(out).toEqual([]);
    // Capped at MAX_SEARCH_ATTEMPTS (4), never more.
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });
});

describe("relaxationCandidates", () => {
  it("drops trailing words one at a time, then the leading article", () => {
    expect(relaxationCandidates("the batman begins")).toEqual([
      "the batman begins", "the batman", "the", "batman begins",
    ]);
  });
  it("adds an article-stripped variant for a two-word title", () => {
    expect(relaxationCandidates("the expanse")).toEqual(["the expanse", "the", "expanse"]);
  });
  it("returns just the query for a single non-article word (no wasted attempts)", () => {
    expect(relaxationCandidates("dune")).toEqual(["dune"]);
  });
  it("caps the candidate list so a long query can't fan out", () => {
    expect(relaxationCandidates("a b c d e f").length).toBeLessThanOrEqual(4);
  });
});

describe("getTitleDetails", () => {
  it("merges details, credits, and external ids for a movie", async () => {
    mockFetchOnce({
      id: 1, title: "Dune", release_date: "2021-10-22", poster_path: "/a.jpg", backdrop_path: "/bd.jpg",
      overview: "Sand.", tagline: "Beyond fear, destiny awaits.", runtime: 155, vote_average: 8.0,
      genres: [{ name: "Sci-Fi" }, { name: "Adventure" }],
      external_ids: { imdb_id: "tt1160419" },
      credits: {
        cast: [{ name: "Timothée", character: "Paul", profile_path: "/tc.jpg" }, { name: "Zendaya", character: "Chani" }],
        crew: [{ job: "Director", name: "Denis Villeneuve" }],
      },
      "watch/providers": {
        results: {
          ZA: {
            link: "https://www.themoviedb.org/movie/1-dune/watch?locale=ZA",
            flatrate: [{ provider_name: "Netflix", logo_path: "/nf.jpg" }],
            rent: [{ provider_name: "Apple TV", logo_path: "/atv.jpg" }],
            buy: [{ provider_name: "Apple TV", logo_path: "/atv.jpg" }],
          },
        },
      },
    });
    const out = await getTitleDetails(1, "MOVIE");
    expect(out.imdbId).toBe("tt1160419");
    expect(out.director).toBe("Denis Villeneuve");
    expect(out.genres).toEqual(["Sci-Fi", "Adventure"]);
    expect(out.cast[0]).toEqual({ name: "Timothée", character: "Paul", profileUrl: "https://image.tmdb.org/t/p/w185/tc.jpg" });
    expect(out.cast[1]).toEqual({ name: "Zendaya", character: "Chani", profileUrl: null });
    expect(out.tmdbScore).toBe(8.0);
    expect(out.runtime).toBe(155);
    expect(out.numberOfSeasons).toBeNull();
    expect(out.numberOfEpisodes).toBeNull();
    // flatrate only — rent/buy must not leak in, this is a watchlist not a shopping guide
    expect(out.watchProviders).toEqual([{ name: "Netflix", logoUrl: "https://image.tmdb.org/t/p/w92/nf.jpg" }]);
    expect(out.watchLink).toBe("https://www.themoviedb.org/movie/1-dune/watch?locale=ZA");
    expect(out.backdropUrl).toBe("https://image.tmdb.org/t/p/w1280/bd.jpg");
    expect(out.tagline).toBe("Beyond fear, destiny awaits.");
  });

  it("treats a missing backdrop as null and an empty-string tagline as null", async () => {
    mockFetchOnce({
      id: 5, title: "No Extras", release_date: "2019-01-01",
      tagline: "", genres: [], credits: { cast: [], crew: [] },
    });
    const out = await getTitleDetails(5, "MOVIE");
    expect(out.backdropUrl).toBeNull();
    expect(out.tagline).toBeNull();
  });

  it("returns empty watch providers and null link when the ZA region has no data", async () => {
    mockFetchOnce({
      id: 4, title: "No Region Data", release_date: "2019-01-01",
      genres: [], credits: { cast: [], crew: [] },
      "watch/providers": { results: { US: { flatrate: [{ provider_name: "Netflix", logo_path: "/nf.jpg" }] } } },
    });
    const out = await getTitleDetails(4, "MOVIE");
    expect(out.watchProviders).toEqual([]);
    expect(out.watchLink).toBeNull();
  });

  it("merges details for a TV series (name, first_air_date, episode_run_time)", async () => {
    mockFetchOnce({
      id: 2, name: "Severance", first_air_date: "2022-02-18", poster_path: "/b.jpg",
      overview: "Work.", episode_run_time: [50], vote_average: 8.4,
      number_of_seasons: 2, number_of_episodes: 19,
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
    expect(out.cast[0]).toEqual({ name: "Adam Scott", character: "Mark", profileUrl: null });
    expect(out.tmdbScore).toBe(8.4);
    expect(out.numberOfSeasons).toBe(2);
    expect(out.numberOfEpisodes).toBe(19);
  });

  it("leaves numberOfSeasons/numberOfEpisodes null when TMDb omits them for a TV series", async () => {
    mockFetchOnce({
      id: 3, name: "No Data Show", first_air_date: "2020-01-01",
      genres: [], credits: { cast: [], crew: [] },
    });
    const out = await getTitleDetails(3, "TV");
    expect(out.numberOfSeasons).toBeNull();
    expect(out.numberOfEpisodes).toBeNull();
  });
});
