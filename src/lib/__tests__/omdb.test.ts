import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { getScoresByImdbId } from "@/lib/omdb";

beforeEach(() => { process.env.OMDB_API_KEY = "k"; });
afterEach(() => { vi.restoreAllMocks(); });

function mockFetchOnce(json: unknown) {
  return vi.spyOn(global, "fetch").mockResolvedValueOnce(
    new Response(JSON.stringify(json), { status: 200 }),
  );
}

describe("getScoresByImdbId", () => {
  it("extracts imdb, rotten tomatoes, metacritic", async () => {
    mockFetchOnce({
      Response: "True",
      imdbRating: "8.0",
      Metascore: "74",
      Ratings: [
        { Source: "Internet Movie Database", Value: "8.0/10" },
        { Source: "Rotten Tomatoes", Value: "83%" },
        { Source: "Metacritic", Value: "74/100" },
      ],
    });
    const out = await getScoresByImdbId("tt1160419");
    expect(out).toEqual({ imdbScore: "8.0", rtScore: "83%", metacriticScore: "74" });
  });

  it("returns nulls when omdb reports not found", async () => {
    mockFetchOnce({ Response: "False", Error: "Incorrect IMDb ID." });
    const out = await getScoresByImdbId("tt0");
    expect(out).toEqual({ imdbScore: null, rtScore: null, metacriticScore: null });
  });
});
