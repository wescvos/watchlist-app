import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("@/lib/currentUser", () => ({ requireUserId: vi.fn().mockResolvedValue("u1") }));
vi.mock("@/lib/titles", () => ({
  getTitle: vi.fn(),
  getCatalogTitle: vi.fn(),
  refreshTitle: vi.fn(),
  isStale: vi.fn(),
}));
vi.mock("@/lib/mood/tagger", () => ({ tagIfUntagged: vi.fn() }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/app/title/[id]/TitleDetail", () => ({ TitleDetail: () => null }));
// Like the real ones, these throw so the page stops at the call.
const { redirectSpy, notFoundSpy } = vi.hoisted(() => ({
  redirectSpy: vi.fn((url: string) => {
    throw new Error(`REDIRECT:${url}`);
  }),
  notFoundSpy: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("next/navigation", () => ({ redirect: redirectSpy, notFound: notFoundSpy }));

import { getTitle, getCatalogTitle, refreshTitle, isStale } from "@/lib/titles";
import TitlePage from "@/app/title/[id]/page";

const mock = (fn: unknown) => fn as Mock;
const params = Promise.resolve({ id: "t1" });

beforeEach(() => {
  vi.clearAllMocks();
  mock(isStale).mockReturnValue(false);
});

describe("/title/[id]", () => {
  it("redirects to the preview when the user has no entry but the catalog has the title", async () => {
    mock(getTitle).mockResolvedValue(null);
    mock(getCatalogTitle).mockResolvedValue({ tmdbId: 123, mediaType: "MOVIE" });

    await expect(TitlePage({ params })).rejects.toThrow("REDIRECT:/preview/movie/123");

    expect(getTitle).toHaveBeenCalledWith("u1", "t1");
    expect(getCatalogTitle).toHaveBeenCalledWith("t1");
  });

  it("calls notFound when neither an entry nor a catalog row exists", async () => {
    mock(getTitle).mockResolvedValue(null);
    mock(getCatalogTitle).mockResolvedValue(null);

    await expect(TitlePage({ params })).rejects.toThrow("NOT_FOUND");

    expect(redirectSpy).not.toHaveBeenCalled();
  });

  it("refreshes a stale entry, then re-reads it for this user", async () => {
    const stale = { id: "t1", fetchedAt: new Date("2020-01-01") };
    const fresh = { id: "t1", fetchedAt: new Date() };
    mock(getTitle).mockResolvedValueOnce(stale).mockResolvedValueOnce(fresh);
    mock(isStale).mockReturnValue(true);
    mock(refreshTitle).mockResolvedValue({});

    await TitlePage({ params });

    expect(refreshTitle).toHaveBeenCalledWith("t1");
    expect(getTitle).toHaveBeenCalledTimes(2);
    expect(getTitle).toHaveBeenLastCalledWith("u1", "t1");
  });

  it("keeps the cached entry when the refresh fails", async () => {
    mock(getTitle).mockResolvedValue({ id: "t1", fetchedAt: new Date("2020-01-01") });
    mock(isStale).mockReturnValue(true);
    mock(refreshTitle).mockRejectedValue(new Error("tmdb down"));

    await TitlePage({ params });

    expect(getTitle).toHaveBeenCalledTimes(1);
  });
});
