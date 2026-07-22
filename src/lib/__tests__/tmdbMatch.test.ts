import { describe, it, expect } from "vitest";
import { normalize, isCloseMatch, evaluateMatch } from "@/lib/tmdbMatch";
import type { SearchResult } from "@/lib/types";
import type { MediaKind } from "@/lib/types";

// These lock the exact matcher behaviour the Google Takeout import relied on
// (it had no tests of its own), so the extraction into the shared module can't
// silently change it.
function sr(o: Partial<SearchResult> & { tmdbId: number; title: string; mediaType: MediaKind }): SearchResult {
  return { year: null, posterUrl: null, popularity: 1, voteCount: 1, ...o };
}

describe("normalize", () => {
  it("strips diacritics, punctuation, and case", () => {
    expect(normalize("Amélie!")).toBe("amelie");
    expect(normalize("The Lord of the Rings: Return of the King")).toBe("the lord of the rings return of the king");
  });
});

describe("isCloseMatch", () => {
  it("matches exact and near-exact titles, rejects distinct ones", () => {
    expect(isCloseMatch("Whiplash", "Whiplash")).toBe(true);
    expect(isCloseMatch("The Lord of the Rings", "The Lord of the Ring")).toBe(true); // 1 char off in a long title
    expect(isCloseMatch("Dune", "Elf")).toBe(false);
  });
});

describe("evaluateMatch", () => {
  it("reviews when there are no results", () => {
    expect(evaluateMatch("Dune", []).outcome).toBe("review");
  });

  it("reviews when the top result is not a close title match", () => {
    const out = evaluateMatch("Dune", [sr({ tmdbId: 1, title: "Encanto", mediaType: "MOVIE" })]);
    expect(out.outcome).toBe("review");
  });

  it("is confident with a single close distinct match", () => {
    const out = evaluateMatch("Dune", [sr({ tmdbId: 1, title: "Dune", mediaType: "MOVIE", year: 2021 })]);
    expect(out.outcome).toBe("confident");
    expect(out.candidate?.tmdbId).toBe(1);
  });

  it("breaks a tie when one candidate dominates by vote count", () => {
    const out = evaluateMatch("Dune", [
      sr({ tmdbId: 1, title: "Dune", mediaType: "MOVIE", year: 2021, voteCount: 10000, popularity: 100 }),
      sr({ tmdbId: 2, title: "Dune", mediaType: "MOVIE", year: 1984, voteCount: 500, popularity: 8 }),
    ]);
    expect(out.outcome).toBe("tiebreak");
    expect(out.candidate?.tmdbId).toBe(1);
  });

  it("reviews (drops) when multiple close matches have no dominant winner", () => {
    const out = evaluateMatch("The Office", [
      sr({ tmdbId: 1, title: "The Office", mediaType: "TV", year: 2005, voteCount: 4000, popularity: 30 }),
      sr({ tmdbId: 2, title: "The Office", mediaType: "TV", year: 2001, voteCount: 3500, popularity: 28 }),
    ]);
    expect(out.outcome).toBe("review");
  });
});
