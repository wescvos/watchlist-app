import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import SearchPage from "@/app/search/page";
import { listCache, emptyListState, type Status } from "@/lib/listCache";
import type { CardTitle } from "@/components/TitleCard";

// The router object must be a single stable instance, matching the real
// useRouter — a fresh object per call invalidates effect deps on every render.
const { replaceSpy, routerMock } = vi.hoisted(() => {
  const replaceSpy = vi.fn();
  return {
    replaceSpy,
    routerMock: { replace: replaceSpy, push: vi.fn(), back: vi.fn(), refresh: vi.fn() },
  };
});

vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
  useSearchParams: () => new URLSearchParams(),
}));

type FetchLike = (url: string) => Promise<{ ok: boolean; json: () => Promise<unknown> }>;

function result(id: number, title: string) {
  return { tmdbId: id, mediaType: "MOVIE", title, year: 2020, posterUrl: null, popularity: 1, voteCount: 1, library: null };
}

// Routes /api/titles (poster wall) and /api/search (per-query, optionally
// deferred so tests can control response order for staleness checks).
function installFetch(opts?: {
  wallWant?: { posterUrl: string | null }[];
  wallWatched?: { posterUrl: string | null }[];
  searchResults?: (q: string) => unknown[];
  deferSearch?: boolean;
}) {
  const searchCalls: string[] = [];
  const titlesCalls: string[] = [];
  const pending = new Map<string, (v: unknown[]) => void>();
  const mock = vi.fn(async (url: string) => {
    const u = new URL(url, "http://localhost");
    if (u.pathname === "/api/titles") {
      const status = u.searchParams.get("status") ?? "";
      titlesCalls.push(status);
      const rows = status === "WANT" ? (opts?.wallWant ?? []) : (opts?.wallWatched ?? []);
      return { ok: true, json: async () => rows };
    }
    const q = u.searchParams.get("q") ?? "";
    searchCalls.push(q);
    if (opts?.deferSearch) {
      return { ok: true, json: () => new Promise<unknown>((res) => pending.set(q, res)) };
    }
    return { ok: true, json: async () => opts?.searchResults?.(q) ?? [] };
  });
  vi.stubGlobal("fetch", mock as unknown as FetchLike);
  return {
    searchCalls,
    titlesCalls,
    resolve: (q: string, value: unknown[]) => {
      pending.get(q)?.(value);
      pending.delete(q);
    },
  };
}

function cardTitle(id: string, posterUrl: string | null): CardTitle {
  return { id, title: id, year: 2020, posterUrl, myRating: null, imdbScore: null, genres: [], mediaType: "MOVIE", pinned: false };
}

function setListCache(status: Status, titles: CardTitle[]) {
  listCache[status] = { titles, loaded: true, fetching: false, error: false };
}

const input = () => screen.getByLabelText("Search movies and series");
const type = (value: string) => fireEvent.change(input(), { target: { value } });
const flush = () => act(async () => {});
const advance = (ms: number) => act(async () => { await vi.advanceTimersByTimeAsync(ms); });

beforeEach(() => {
  // Only fake what the debounce uses — faking everything destabilises jsdom
  // and React's scheduler under the vitest worker.
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  replaceSpy.mockClear();
  // The shared list cache is a module-level singleton — reset it so one
  // test's cache state can't leak into the next.
  listCache.WANT = emptyListState;
  listCache.WATCHED = emptyListState;
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("search-as-you-type", () => {
  it("does not fire below 2 characters", async () => {
    const { searchCalls } = installFetch();
    render(<SearchPage />);
    await flush();
    type("d");
    await advance(1000);
    expect(searchCalls).toEqual([]);
  });

  it("fires exactly one search for the settled term after the debounce window", async () => {
    const { searchCalls } = installFetch({ searchResults: () => [result(1, "Dune")] });
    render(<SearchPage />);
    await flush();
    type("du");
    await advance(100);
    type("dun");
    await advance(100);
    type("dune");
    await advance(350);
    await flush();
    expect(searchCalls).toEqual(["dune"]);
    expect(screen.getByText("Dune")).toBeInTheDocument();
    // URL synced once, when the search fired — not per keystroke.
    expect(replaceSpy).toHaveBeenCalledTimes(1);
    expect(replaceSpy).toHaveBeenCalledWith("/search?q=dune", { scroll: false });
  });

  it("a stale response never overwrites a newer one", async () => {
    const { searchCalls, resolve } = installFetch({ deferSearch: true });
    render(<SearchPage />);
    await flush();
    type("alien");
    await advance(350);
    type("aliens");
    await advance(350);
    expect(searchCalls).toEqual(["alien", "aliens"]);
    // Newer response lands first…
    resolve("aliens", [result(2, "Aliens (1986)")]);
    await flush();
    expect(screen.getByText("Aliens (1986)")).toBeInTheDocument();
    // …then the older one arrives late and must be discarded.
    resolve("alien", [result(1, "Alien (1979)")]);
    await flush();
    expect(screen.queryByText("Alien (1979)")).not.toBeInTheDocument();
    expect(screen.getByText("Aliens (1986)")).toBeInTheDocument();
  });

  it("clearing cancels a pending debounce so no search fires afterwards", async () => {
    const { searchCalls } = installFetch();
    render(<SearchPage />);
    await flush();
    type("dune");
    await advance(100); // debounce still pending
    fireEvent.click(screen.getByLabelText("Clear search"));
    await advance(1000);
    expect(searchCalls).toEqual([]);
    expect((input() as HTMLInputElement).value).toBe("");
  });

  it("Enter submits immediately and the pending debounce does not re-fire it", async () => {
    const { searchCalls } = installFetch({ searchResults: () => [result(1, "Dune")] });
    render(<SearchPage />);
    await flush();
    type("dune");
    fireEvent.submit(input().closest("form")!);
    await flush();
    expect(searchCalls).toEqual(["dune"]);
    await advance(1000);
    expect(searchCalls).toEqual(["dune"]); // still exactly one
  });

  it("deleting below 2 characters returns to the pre-search state", async () => {
    const { searchCalls } = installFetch({ searchResults: () => [result(1, "Dune")] });
    render(<SearchPage />);
    await flush();
    type("dune");
    await advance(350);
    await flush();
    expect(screen.getByText("Dune")).toBeInTheDocument();
    type("d");
    await flush();
    expect(screen.queryByText("Dune")).not.toBeInTheDocument();
    expect(screen.getByText("Find something to watch")).toBeInTheDocument();
    expect(searchCalls).toEqual(["dune"]); // no extra call for the short term
  });
});

describe("poster wall", () => {
  it("builds the wall from Want posters, padded with Watched, at the small size", async () => {
    installFetch({
      wallWant: [
        { posterUrl: "https://image.tmdb.org/t/p/w500/a.jpg" },
        { posterUrl: null }, // titles without posters are skipped
        { posterUrl: "https://image.tmdb.org/t/p/w500/b.jpg" },
      ],
      wallWatched: [{ posterUrl: "https://image.tmdb.org/t/p/w500/c.jpg" }],
    });
    const { container } = render(<SearchPage />);
    await flush();
    const tiles = Array.from(container.querySelectorAll("img")).map((img) => img.getAttribute("src"));
    expect(tiles).toEqual([
      "https://image.tmdb.org/t/p/w185/a.jpg",
      "https://image.tmdb.org/t/p/w185/b.jpg",
      "https://image.tmdb.org/t/p/w185/c.jpg",
    ]);
    // No overlay headline on the wall itself — redundant with the input's placeholder.
    expect(screen.queryByText("Find something to watch")).not.toBeInTheDocument();
  });

  it("falls back to the plain glyph state when the library has no posters", async () => {
    installFetch();
    const { container } = render(<SearchPage />);
    await flush();
    expect(container.querySelectorAll("img").length).toBe(0);
    expect(screen.getByText("Find something to watch")).toBeInTheDocument();
  });

  it("renders instantly from Home's shared cache, with no fetch to /api/titles at all", () => {
    // 20 usable Want posters — at the wall's cap, so Watched must NOT be consulted.
    setListCache("WANT", Array.from({ length: 20 }, (_, i) => cardTitle(`w${i}`, `https://image.tmdb.org/t/p/w500/${i}.jpg`)));
    setListCache("WATCHED", [cardTitle("watched-1", "https://image.tmdb.org/t/p/w500/should-not-appear.jpg")]);
    const { titlesCalls } = installFetch();
    const { container } = render(<SearchPage />);
    // No `await flush()` — the assertion runs against the very first render,
    // proving the cache read is synchronous (no fetch round trip in between).
    const tiles = Array.from(container.querySelectorAll("img")).map((img) => img.getAttribute("src"));
    expect(tiles).toHaveLength(20);
    expect(tiles).not.toContain("https://image.tmdb.org/t/p/w185/should-not-appear.jpg");
    expect(titlesCalls).toEqual([]);
  });

  it("pads with the cached Watched list when cached Want is thin, still with no fetch", () => {
    setListCache("WANT", [cardTitle("1", "https://image.tmdb.org/t/p/w500/a.jpg")]);
    setListCache("WATCHED", [cardTitle("2", "https://image.tmdb.org/t/p/w500/b.jpg")]);
    const { titlesCalls } = installFetch();
    const { container } = render(<SearchPage />);
    const tiles = Array.from(container.querySelectorAll("img")).map((img) => img.getAttribute("src"));
    expect(tiles).toEqual([
      "https://image.tmdb.org/t/p/w185/a.jpg",
      "https://image.tmdb.org/t/p/w185/b.jpg",
    ]);
    expect(titlesCalls).toEqual([]);
  });

  it("falls back to fetching when the shared cache is empty (cold start)", async () => {
    // listCache is reset to emptyListState in beforeEach — nothing cached.
    const { titlesCalls } = installFetch({
      wallWant: [{ posterUrl: "https://image.tmdb.org/t/p/w500/cold.jpg" }],
    });
    const { container } = render(<SearchPage />);
    await flush();
    const tiles = Array.from(container.querySelectorAll("img")).map((img) => img.getAttribute("src"));
    expect(tiles).toEqual(["https://image.tmdb.org/t/p/w185/cold.jpg"]);
    expect(titlesCalls).toEqual(["WANT", "WATCHED"]);
  });
});
