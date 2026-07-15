import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@/lib/tmdb", () => ({
  getTitleDetails: vi.fn(),
}));
vi.mock("@/lib/omdb", () => ({
  getScoresByImdbId: vi.fn(),
}));

import { getTitleDetails } from "@/lib/tmdb";
import { getScoresByImdbId } from "@/lib/omdb";
import { fetchMergedTitle } from "@/lib/fetchTitle";

const base = {
  tmdbId: 1, mediaType: "MOVIE" as const, imdbId: "tt1", title: "Dune", year: 2021,
  posterUrl: null, overview: "x", runtime: 155, genres: ["Sci-Fi"],
  cast: [{ name: "A", character: "B" }], director: "D", tmdbScore: 8.0,
};

describe("fetchMergedTitle", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("merges TMDb details with OMDb scores when imdbId present", async () => {
    (getTitleDetails as any).mockResolvedValue(base);
    (getScoresByImdbId as any).mockResolvedValue({ imdbScore: "8.0", rtScore: "83%", metacriticScore: "74" });
    const out = await fetchMergedTitle(1, "MOVIE");
    expect(out.rtScore).toBe("83%");
    expect(out.title).toBe("Dune");
    expect(getScoresByImdbId).toHaveBeenCalledWith("tt1");
  });

  it("skips OMDb and returns null scores when no imdbId", async () => {
    (getTitleDetails as any).mockResolvedValue({ ...base, imdbId: null });
    const out = await fetchMergedTitle(1, "MOVIE");
    expect(out.imdbScore).toBeNull();
    expect(getScoresByImdbId).not.toHaveBeenCalled();
  });
});
