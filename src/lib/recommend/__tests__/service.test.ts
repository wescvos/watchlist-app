import { describe, it, expect, vi, beforeEach } from "vitest";

// Keep the REAL tmdbMatch matcher so resolution is tested against the actual
// dominance/drop discipline; mock only the IO boundaries.
vi.mock("@/lib/tmdb", () => ({ searchTitles: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { title: { findMany: vi.fn(), findUnique: vi.fn() } } }));
vi.mock("@/lib/recommendations", () => ({ saveRecommendationSet: vi.fn(), getDismissedKeySet: vi.fn() }));
vi.mock("@/lib/recommend/provider", () => ({ getProvider: vi.fn() }));

import { searchTitles } from "@/lib/tmdb";
import { prisma } from "@/lib/prisma";
import { saveRecommendationSet, getDismissedKeySet } from "@/lib/recommendations";
import { getProvider } from "@/lib/recommend/provider";
import {
  buildRatedHistory,
  resolveSuggestions,
  generateRecommendations,
  RecommendationError,
} from "@/lib/recommend/service";
import type { SearchResult, MediaKind } from "@/lib/types";
import type { RawSuggestion, RecommendationProvider } from "@/lib/recommend/types";

const searchMock = vi.mocked(searchTitles);
const findMany = vi.mocked(prisma.title.findMany);
const findUnique = vi.mocked(prisma.title.findUnique);
const saveMock = vi.mocked(saveRecommendationSet);
const dismissedMock = vi.mocked(getDismissedKeySet);
const getProviderMock = vi.mocked(getProvider);

function sr(o: Partial<SearchResult> & { tmdbId: number; title: string; mediaType: MediaKind }): SearchResult {
  return { year: null, posterUrl: null, popularity: 1, voteCount: 1, ...o };
}
function raw(o: Partial<RawSuggestion> & { title: string; mediaType: MediaKind }): RawSuggestion {
  return { year: null, reason: "because", ...o };
}
function fakeProvider(recommend: RecommendationProvider["recommend"]): RecommendationProvider {
  return { model: "gemini-2.5-flash", recommend };
}
function watchedRow() {
  return [{ title: "Whiplash", year: 2014, mediaType: "MOVIE", myRating: 9 }] as unknown as Awaited<
    ReturnType<typeof prisma.title.findMany>
  >;
}

beforeEach(() => {
  vi.clearAllMocks();
  findUnique.mockResolvedValue(null); // nothing already in the library
  dismissedMock.mockResolvedValue(new Set()); // nothing dismissed
});

describe("buildRatedHistory", () => {
  it("selects only watched + rated titles and maps to the whitelist", async () => {
    findMany.mockResolvedValue(watchedRow());
    const out = await buildRatedHistory();
    const arg = findMany.mock.calls[0][0];
    expect(arg?.where).toEqual({ status: "WATCHED", myRating: { not: null } });
    // Capped, strongest-signal slice: highest-rated first, recency as tiebreak.
    expect(arg?.orderBy).toEqual([{ myRating: "desc" }, { watchedAt: "desc" }]);
    expect(arg?.take).toBe(50);
    expect(out).toEqual([{ title: "Whiplash", year: 2014, mediaType: "MOVIE", myRating: 9 }]);
  });
});

describe("resolveSuggestions", () => {
  it("resolves a single confident match to a linkable suggestion", async () => {
    searchMock.mockResolvedValueOnce([sr({ tmdbId: 10, title: "Sicario", mediaType: "MOVIE", year: 2015, posterUrl: "p" })]);
    const resolved = await resolveSuggestions([raw({ title: "Sicario", year: 2015, mediaType: "MOVIE", reason: "tense" })]);
    expect(resolved).toEqual([
      { tmdbId: 10, mediaType: "MOVIE", title: "Sicario", year: 2015, posterUrl: "p", reason: "tense" },
    ]);
  });

  it("uses mediaType + year as strong pre-filters", async () => {
    // Same title, two media types/years; the TV 2014 suggestion must pick the TV entry.
    searchMock.mockResolvedValueOnce([
      sr({ tmdbId: 1, title: "Fargo", mediaType: "MOVIE", year: 1996, voteCount: 8000, popularity: 40 }),
      sr({ tmdbId: 2, title: "Fargo", mediaType: "TV", year: 2014, voteCount: 3000, popularity: 30 }),
    ]);
    const resolved = await resolveSuggestions([raw({ title: "Fargo", year: 2014, mediaType: "TV" })]);
    expect(resolved.map((r) => r.tmdbId)).toEqual([2]);
  });

  it("drops an ambiguous suggestion with no dominant match rather than guessing", async () => {
    searchMock.mockResolvedValueOnce([
      sr({ tmdbId: 3, title: "The Office", mediaType: "TV", year: 2005, voteCount: 4000, popularity: 30 }),
      sr({ tmdbId: 4, title: "The Office", mediaType: "TV", year: 2001, voteCount: 3500, popularity: 28 }),
    ]);
    const resolved = await resolveSuggestions([raw({ title: "The Office", year: null, mediaType: "TV" })]);
    expect(resolved).toEqual([]);
  });

  it("drops a suggestion already in the library", async () => {
    searchMock.mockResolvedValueOnce([sr({ tmdbId: 10, title: "Sicario", mediaType: "MOVIE", year: 2015 })]);
    findUnique.mockResolvedValueOnce({ id: "existing" } as unknown as Awaited<ReturnType<typeof prisma.title.findUnique>>);
    const resolved = await resolveSuggestions([raw({ title: "Sicario", year: 2015, mediaType: "MOVIE" })]);
    expect(resolved).toEqual([]);
  });

  it("drops a suggestion that has been dismissed", async () => {
    dismissedMock.mockResolvedValue(new Set(["MOVIE:10"]));
    searchMock.mockResolvedValueOnce([sr({ tmdbId: 10, title: "Sicario", mediaType: "MOVIE", year: 2015 })]);
    const resolved = await resolveSuggestions([raw({ title: "Sicario", year: 2015, mediaType: "MOVIE" })]);
    expect(resolved).toEqual([]);
    // Dismissed short-circuits before the library lookup.
    expect(findUnique).not.toHaveBeenCalled();
  });

  it("dedupes two suggestions that resolve to the same title", async () => {
    const hit = [sr({ tmdbId: 10, title: "Sicario", mediaType: "MOVIE", year: 2015 })];
    searchMock.mockResolvedValueOnce(hit).mockResolvedValueOnce(hit);
    const resolved = await resolveSuggestions([
      raw({ title: "Sicario", year: 2015, mediaType: "MOVIE" }),
      raw({ title: "Sicario", year: 2015, mediaType: "MOVIE" }),
    ]);
    expect(resolved.map((r) => r.tmdbId)).toEqual([10]);
  });
});

describe("generateRecommendations", () => {
  it("returns empty (no provider call) when there is no rated history", async () => {
    findMany.mockResolvedValue([] as unknown as Awaited<ReturnType<typeof prisma.title.findMany>>);
    const out = await generateRecommendations();
    expect(out).toEqual({ empty: true, set: null });
    expect(getProviderMock).not.toHaveBeenCalled();
  });

  it("saves and returns a set on success", async () => {
    findMany.mockResolvedValue(watchedRow());
    getProviderMock.mockReturnValue(fakeProvider(vi.fn().mockResolvedValue([raw({ title: "Sicario", year: 2015, mediaType: "MOVIE", reason: "tense" })])));
    searchMock.mockResolvedValueOnce([sr({ tmdbId: 10, title: "Sicario", mediaType: "MOVIE", year: 2015, posterUrl: "p" })]);
    saveMock.mockResolvedValue({ id: "set1" } as unknown as Awaited<ReturnType<typeof saveRecommendationSet>>);

    const out = await generateRecommendations();
    const arg = saveMock.mock.calls[0][0];
    expect(arg.model).toBe("gemini-2.5-flash");
    expect(arg.sourceCount).toBe(1);
    expect(arg.suggestions.map((s) => s.tmdbId)).toEqual([10]);
    expect(out).toEqual({ empty: false, set: { id: "set1" } });
  });

  it("exhaustion is not an error: saves an empty set when nothing new survives filtering", async () => {
    findMany.mockResolvedValue(watchedRow());
    getProviderMock.mockReturnValue(fakeProvider(vi.fn().mockResolvedValue([raw({ title: "Sicario", year: 2015, mediaType: "MOVIE" })])));
    searchMock.mockResolvedValueOnce([sr({ tmdbId: 10, title: "Sicario", mediaType: "MOVIE", year: 2015 })]);
    findUnique.mockResolvedValueOnce({ id: "existing" } as unknown as Awaited<ReturnType<typeof prisma.title.findUnique>>);
    saveMock.mockResolvedValue({ id: "set-empty" } as unknown as Awaited<ReturnType<typeof saveRecommendationSet>>);

    const out = await generateRecommendations();
    expect(saveMock.mock.calls[0][0].suggestions).toEqual([]);
    expect(out.empty).toBe(false);
  });

  it("exhaustion is not an error: saves an empty set when nothing resolves to TMDb", async () => {
    findMany.mockResolvedValue(watchedRow());
    getProviderMock.mockReturnValue(fakeProvider(vi.fn().mockResolvedValue([raw({ title: "Nonexistent Film", mediaType: "MOVIE" })])));
    searchMock.mockResolvedValueOnce([]); // no TMDb match → dropped, but not a failure
    saveMock.mockResolvedValue({ id: "set-empty" } as unknown as Awaited<ReturnType<typeof saveRecommendationSet>>);

    const out = await generateRecommendations();
    expect(saveMock.mock.calls[0][0].suggestions).toEqual([]);
    expect(out.empty).toBe(false);
  });

  it("propagates a genuine provider error (rate limit / timeout / malformed) to the caller", async () => {
    findMany.mockResolvedValue(watchedRow());
    getProviderMock.mockReturnValue(fakeProvider(vi.fn().mockRejectedValue(new RecommendationError("boom", "rate_limit"))));
    await expect(generateRecommendations()).rejects.toBeInstanceOf(RecommendationError);
    expect(saveMock).not.toHaveBeenCalled();
  });
});
