import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import type { CardTitle } from "@/components/TitleCard";
import { listCache, emptyListState } from "@/lib/listCache";
import { persistLists } from "@/lib/listPersist";
import { LOADING_DELAY_MS } from "@/lib/loadingDelay";

const { routerMock } = vi.hoisted(() => ({
  routerMock: { replace: vi.fn(), push: vi.fn(), back: vi.fn(), refresh: vi.fn() },
}));
vi.mock("next/navigation", () => ({
  useRouter: () => routerMock,
  useSearchParams: () => new URLSearchParams(),
}));

import Home from "@/app/page";

function card(i: number, overrides: Partial<CardTitle> = {}): CardTitle {
  return {
    id: `id${i}`,
    title: `Film ${i}`,
    year: 2000 + i,
    posterUrl: `https://image.tmdb.org/t/p/w500/p${i}.jpg`,
    myRating: null,
    imdbScore: "7.5",
    genres: ["Drama"],
    mediaType: "MOVIE",
    pinned: false,
    ...overrides,
  };
}

/** A fetch that never settles, so tests observe the pre-network paint only. */
function stubPendingFetch() {
  const fn = vi.fn((url: string) => {
    void url;
    return new Promise<Response>(() => {});
  });
  vi.stubGlobal("fetch", fn);
  return fn;
}

/** A fetch that resolves with the given list for both statuses. */
function stubFetch(titles: CardTitle[]) {
  const fn = vi.fn(async () => ({ ok: true, json: async () => titles }) as unknown as Response);
  vi.stubGlobal("fetch", fn);
  return fn;
}

// The poster blocks specifically, not the text-line placeholders inside a tile.
const skeletons = (container: HTMLElement) =>
  container.querySelectorAll("[aria-hidden='true'] > div > .aspect-\\[2\\/3\\].animate-pulse");

/** Push past the skeleton's grace period. */
async function advancePastDelay() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, LOADING_DELAY_MS + 20));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  window.localStorage.clear();
  // A genuinely cold launch: nothing in memory either.
  listCache.WANT = emptyListState;
  listCache.WATCHED = emptyListState;
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("the skeleton is delayed, so a fast load never flashes it", () => {
  it("renders no skeleton inside the delay threshold", async () => {
    // The whole point: data now usually arrives within a frame or two, so an
    // immediate skeleton appeared and vanished, reading as a glitch.
    stubPendingFetch();

    const { container } = render(<Home />);

    expect(skeletons(container)).toHaveLength(0);
    // Nor any other resolved state: an unloaded list must not look empty.
    expect(screen.queryByText("Nothing on your list")).not.toBeInTheDocument();
    expect(screen.queryByText("Nothing matches this filter yet")).not.toBeInTheDocument();
  });

  it("shows the skeleton once the threshold passes on a genuinely slow load", async () => {
    // THE GUARD, still intact: an absent persisted cache must not look like
    // loaded-but-empty, and a real wait must still get feedback.
    stubPendingFetch();

    const { container } = render(<Home />);
    await advancePastDelay();

    expect(skeletons(container).length).toBeGreaterThan(0);
    expect(screen.queryByText("Nothing on your list")).not.toBeInTheDocument();
  });

  it("never shows a skeleton when data arrives before the threshold", async () => {
    stubFetch([card(1), card(2)]);

    const { container } = render(<Home />);
    expect(skeletons(container)).toHaveLength(0);

    // Data lands first...
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("Film 1")).toBeInTheDocument();
    expect(skeletons(container)).toHaveLength(0);

    // ...and the timer firing afterwards cannot resurrect a skeleton, because
    // the render condition also requires the list to still be unloaded.
    await advancePastDelay();
    expect(skeletons(container)).toHaveLength(0);
  });

  it("still shows the skeleton after the threshold when the stored payload is corrupt", async () => {
    window.localStorage.setItem("watchlist:lists", "{not json");
    stubPendingFetch();

    const { container } = render(<Home />);
    await advancePastDelay();

    expect(skeletons(container).length).toBeGreaterThan(0);
  });

  it("still shows the skeleton after the threshold when the stored payload is an empty library", async () => {
    window.localStorage.setItem(
      "watchlist:lists",
      JSON.stringify({ v: 1, lists: { WANT: [], WATCHED: [] } }),
    );
    stubPendingFetch();

    const { container } = render(<Home />);
    await advancePastDelay();

    expect(skeletons(container).length).toBeGreaterThan(0);
    expect(screen.queryByText("Nothing on your list")).not.toBeInTheDocument();
  });

  it("keeps the skeleton structurally identical to the real grid", async () => {
    // Swapping between two differently-sized layouts reflows the page, which
    // reads as jitter however fast the swap is. These were the three measured
    // differences: the grid's top margin, the two text lines under each poster,
    // and the filter row that only appeared once data landed.
    stubPendingFetch();
    const { container, unmount } = render(<Home />);
    await advancePastDelay();
    const skeletonGrid = container.querySelector(".grid")!;
    const skeletonTile = skeletons(container)[0].parentElement!;
    const skeletonHadFilterRow = !!screen.queryByRole("button", { name: "Movies" });
    unmount();

    listCache.WANT = { titles: [card(1)], loaded: true, fetching: false, error: false };
    listCache.WATCHED = { titles: [], loaded: true, fetching: false, error: false };
    const real = render(<Home />);
    const realGrid = real.container.querySelector(".grid")!;

    expect(skeletonGrid.className).toBe(realGrid.className.replace(" fade-in", ""));
    // Poster block plus the title and meta lines: three children, as TitleCard.
    expect(skeletonTile.children).toHaveLength(3);
    // The filter row is present in both, so it cannot appear on the swap.
    expect(skeletonHadFilterRow).toBe(true);
    expect(screen.queryByRole("button", { name: "Movies" })).toBeInTheDocument();
  });
});

describe("cold launch with a persisted cache", () => {
  beforeEach(() => {
    persistLists({
      WANT: { titles: [card(1), card(2)], loaded: true, fetching: false, error: false },
      WATCHED: { titles: [card(3)], loaded: true, fetching: false, error: false },
    });
    // Persisting goes through the singleton in real use; clear it so this test
    // exercises the disk path rather than the in-memory one.
    listCache.WANT = emptyListState;
    listCache.WATCHED = emptyListState;
  });

  it("paints the list with no skeleton, before any network response", () => {
    // The fetch never settles, so anything rendered here came from disk.
    stubPendingFetch();

    const { container } = render(<Home />);

    expect(skeletons(container)).toHaveLength(0);
    expect(screen.getByText("Film 1")).toBeInTheDocument();
    expect(screen.getByText("Film 2")).toBeInTheDocument();
  });

  it("still revalidates in the background", () => {
    const fetchMock = stubPendingFetch();

    render(<Home />);

    // Persisted data is a fast first paint, never the source of truth.
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls).toContain("/api/titles?status=WANT");
    expect(urls).toContain("/api/titles?status=WATCHED");
  });

  it("swaps in fresh data silently when revalidation differs", async () => {
    stubFetch([card(1), card(2), card(4)]);

    const { container } = render(<Home />);
    expect(screen.getByText("Film 1")).toBeInTheDocument();

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("Film 4")).toBeInTheDocument();
    // No skeleton at any point, and no blank.
    expect(skeletons(container)).toHaveLength(0);
  });

  it("renders posters eagerly, with no lazy loading and no fade-in", () => {
    // The flash saga's two guards, on the seeded path specifically: this is the
    // render that did not previously exist, so it needs its own coverage.
    stubPendingFetch();

    const { container } = render(<Home />);

    const html = container.innerHTML;
    expect(html).not.toContain('loading="lazy"');
    expect(container.querySelectorAll("img[loading]")).toHaveLength(0);
    expect(container.querySelectorAll("img").length).toBeGreaterThan(0);
  });

  it("seeds the shared singleton, so the search wall is warm too", () => {
    stubPendingFetch();

    render(<Home />);

    // The search page's poster wall reads listCache synchronously.
    expect(listCache.WANT.titles).toHaveLength(2);
    expect(listCache.WANT.loaded).toBe(true);
  });
});

describe("warm in-memory cache still wins", () => {
  it("prefers memory over disk, since memory is fresher", () => {
    persistLists({
      WANT: { titles: [card(1)], loaded: true, fetching: false, error: false },
      WATCHED: { titles: [card(2)], loaded: true, fetching: false, error: false },
    });
    // A back-navigation: Home remounts with the singleton already populated.
    listCache.WANT = { titles: [card(99)], loaded: true, fetching: false, error: false };
    stubPendingFetch();

    const { container } = render(<Home />);

    expect(screen.getByText("Film 99")).toBeInTheDocument();
    expect(skeletons(container)).toHaveLength(0);
  });

  it("does not blank or flash on a back-navigation remount", () => {
    listCache.WANT = { titles: [card(1), card(2)], loaded: true, fetching: false, error: false };
    listCache.WATCHED = { titles: [card(3)], loaded: true, fetching: false, error: false };
    stubPendingFetch();

    const { container } = render(<Home />);

    // Warm at mount: grid on the first frame, and no entrance animation to
    // replay (replaying the fade from opacity 0 IS the flash).
    expect(skeletons(container)).toHaveLength(0);
    expect(screen.getByText("Film 1")).toBeInTheDocument();
    expect(container.innerHTML).not.toContain("fade-in");
  });
});
