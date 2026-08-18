import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/lib/prisma", () => ({
  prisma: { title: { findMany: vi.fn() } },
}));
const { notFoundSpy } = vi.hoisted(() => ({ notFoundSpy: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: notFoundSpy }));

import { prisma } from "@/lib/prisma";
import MoodPage from "@/app/mood/page";
import MoodTitlesPage from "@/app/mood/[slug]/page";
import { MOODS, MOOD_LABELS } from "@/lib/moods";

const mock = (fn: unknown) => fn as Mock;

/** A row shaped as the picker's query selects it. */
function pickerRow(
  moods: string[],
  tagged = true,
  extra: { posterUrl?: string | null; imdbScore?: string | null; addedAt?: Date } = {},
) {
  return {
    moods,
    moodsTaggedAt: tagged ? new Date("2026-08-17") : null,
    posterUrl: extra.posterUrl ?? null,
    imdbScore: extra.imdbScore ?? null,
    addedAt: extra.addedAt ?? new Date("2026-01-01"),
  };
}

/** A poster URL as TMDb stores it, at the size the DB holds. */
const poster = (n: number) => `https://image.tmdb.org/t/p/w500/p${n}.jpg`;
/** The size the picker swaps down to for its tile backgrounds. */
const tileSrc = (n: number) => poster(n).replace("/w500/", "/w342/");

/** A row shaped as the grid's query selects it. */
function cardRow(i: number, overrides: Record<string, unknown> = {}) {
  return {
    id: `id${i}`,
    title: `Film ${i}`,
    year: 2000 + i,
    posterUrl: "https://image.tmdb.org/t/p/w500/poster.jpg",
    myRating: null,
    imdbScore: "7.5",
    genres: ["Drama"],
    mediaType: "MOVIE",
    pinned: false,
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("/mood picker", () => {
  it("renders all twelve moods in canonical order", async () => {
    mock(prisma.title.findMany).mockResolvedValue([]);

    const { container } = render(await MoodPage());

    for (const label of MOOD_LABELS) expect(screen.getByText(label)).toBeInTheDocument();
    // Canonical order, not count order, so the grid is stable between visits.
    const rendered = Array.from(container.querySelectorAll("a[href^='/mood/']")).map(
      (a) => a.getAttribute("href"),
    );
    expect(rendered).toEqual(MOODS.map((m) => `/mood/${m.slug}`));
  });

  it("counts each mood from a single query", async () => {
    mock(prisma.title.findMany).mockResolvedValue([
      pickerRow(["Slow-burn dread", "Dark & heavy"]),
      pickerRow(["Slow-burn dread"]),
      pickerRow(["Weird"]),
    ]);

    render(await MoodPage());

    // One query for the whole screen, not one per mood.
    expect(prisma.title.findMany).toHaveBeenCalledTimes(1);
    const dread = screen.getByText("Slow-burn dread").closest("a")!;
    expect(dread).toHaveTextContent("2");
    expect(screen.getByText("Dark & heavy").closest("a")).toHaveTextContent("1");
  });

  it("queries only the Want list", async () => {
    mock(prisma.title.findMany).mockResolvedValue([]);
    render(await MoodPage());
    const arg = mock(prisma.title.findMany).mock.calls[0][0];
    expect(arg.where).toEqual({ status: "WANT" });
  });

  it("keeps zero-count moods present but de-emphasised", async () => {
    mock(prisma.title.findMany).mockResolvedValue([pickerRow(["Weird"])]);

    render(await MoodPage());

    const scary = screen.getByText("Scary").closest("a")!;
    expect(scary).toBeInTheDocument();
    // A quiet dash, not the word "none", which read as an error rather than an
    // empty category.
    expect(scary).toHaveTextContent("–");
    expect(scary.textContent).not.toMatch(/none/i);
    expect(scary.className).toContain("opacity-55");
    expect(screen.getByText("Weird").closest("a")!.className).not.toContain("opacity-55");
  });

  it("shows the untagged count when some titles have never been tagged", async () => {
    mock(prisma.title.findMany).mockResolvedValue([
      pickerRow(["Weird"]),
      pickerRow([], false),
      pickerRow([], false),
    ]);

    render(await MoodPage());

    expect(screen.getByText("2 titles not yet tagged")).toBeInTheDocument();
  });

  it("hides the untagged count when everything is tagged", async () => {
    // The live state after the backfill: 0 untagged Want titles.
    mock(prisma.title.findMany).mockResolvedValue([pickerRow(["Weird"]), pickerRow([])]);

    render(await MoodPage());

    expect(screen.queryByText(/not yet tagged/)).not.toBeInTheDocument();
  });

  it("does not count a tagged-but-moodless title as untagged", async () => {
    // Matching no mood is a legitimate answer, distinct from never being asked.
    mock(prisma.title.findMany).mockResolvedValue([pickerRow([], true)]);

    render(await MoodPage());

    expect(screen.queryByText(/not yet tagged/)).not.toBeInTheDocument();
  });

  it("gives each non-empty mood a poster from one of its own titles", async () => {
    mock(prisma.title.findMany).mockResolvedValue([
      pickerRow(["Weird"], true, { posterUrl: poster(1), imdbScore: "7.0" }),
      pickerRow(["Scary"], true, { posterUrl: poster(2), imdbScore: "6.0" }),
    ]);

    const { container } = render(await MoodPage());

    expect(screen.getByText("Weird").closest("a")!.querySelector("img")).toHaveAttribute("src", tileSrc(1));
    expect(screen.getByText("Scary").closest("a")!.querySelector("img")).toHaveAttribute("src", tileSrc(2));
    // Only the two moods with titles get one.
    expect(container.querySelectorAll("img")).toHaveLength(2);
  });

  it("picks the highest-rated title's poster, deterministically", async () => {
    mock(prisma.title.findMany).mockResolvedValue([
      pickerRow(["Weird"], true, { posterUrl: poster(1), imdbScore: "6.1" }),
      pickerRow(["Weird"], true, { posterUrl: poster(2), imdbScore: "8.4" }),
      pickerRow(["Weird"], true, { posterUrl: poster(3), imdbScore: "7.9" }),
    ]);

    render(await MoodPage());

    expect(screen.getByText("Weird").closest("a")!.querySelector("img")).toHaveAttribute("src", tileSrc(2));
  });

  it("compares ratings numerically, so 10.0 beats 9.0", async () => {
    // imdbScore is a string column, and lexicographically "9.0" sorts above
    // "10.0". This is the one case where string order and real order disagree.
    mock(prisma.title.findMany).mockResolvedValue([
      pickerRow(["Weird"], true, { posterUrl: poster(1), imdbScore: "9.0" }),
      pickerRow(["Weird"], true, { posterUrl: poster(2), imdbScore: "10.0" }),
    ]);

    render(await MoodPage());

    expect(screen.getByText("Weird").closest("a")!.querySelector("img")).toHaveAttribute("src", tileSrc(2));
  });

  it("falls back to the most recently added when ratings tie or are missing", async () => {
    mock(prisma.title.findMany).mockResolvedValue([
      pickerRow(["Weird"], true, { posterUrl: poster(1), imdbScore: null, addedAt: new Date("2026-01-01") }),
      pickerRow(["Weird"], true, { posterUrl: poster(2), imdbScore: null, addedAt: new Date("2026-06-01") }),
    ]);

    render(await MoodPage());

    expect(screen.getByText("Weird").closest("a")!.querySelector("img")).toHaveAttribute("src", tileSrc(2));
  });

  it("prefers a rated title over an unrated one", async () => {
    mock(prisma.title.findMany).mockResolvedValue([
      pickerRow(["Weird"], true, { posterUrl: poster(1), imdbScore: null, addedAt: new Date("2026-06-01") }),
      pickerRow(["Weird"], true, { posterUrl: poster(2), imdbScore: "5.0", addedAt: new Date("2026-01-01") }),
    ]);

    render(await MoodPage());

    expect(screen.getByText("Weird").closest("a")!.querySelector("img")).toHaveAttribute("src", tileSrc(2));
  });

  it("renders the same poster on repeated renders, so tiles do not reshuffle", async () => {
    // Every candidate rated identically: the tie-break must still be total, or
    // the tile would change between visits.
    mock(prisma.title.findMany).mockResolvedValue([
      pickerRow(["Weird"], true, { posterUrl: poster(1), imdbScore: "8.0", addedAt: new Date("2026-02-01") }),
      pickerRow(["Weird"], true, { posterUrl: poster(2), imdbScore: "8.0", addedAt: new Date("2026-03-01") }),
      pickerRow(["Weird"], true, { posterUrl: poster(3), imdbScore: "8.0", addedAt: new Date("2026-01-01") }),
    ]);

    const first = render(await MoodPage()).container.querySelector("img")!.getAttribute("src");
    const second = render(await MoodPage()).container.querySelector("img")!.getAttribute("src");

    expect(first).toBe(second);
    expect(first).toBe(tileSrc(2));
  });

  it("stays stable when rating AND date both tie, whatever order rows arrive in", async () => {
    // The query has no ORDER BY, so Postgres row order is not guaranteed. With
    // an identical rating and addedAt, only a further tie-break keeps the tile
    // from flipping between visits.
    const same = { imdbScore: "8.0", addedAt: new Date("2026-02-01") };
    const rows = [
      pickerRow(["Weird"], true, { posterUrl: poster(1), ...same }),
      pickerRow(["Weird"], true, { posterUrl: poster(2), ...same }),
      pickerRow(["Weird"], true, { posterUrl: poster(3), ...same }),
    ];

    mock(prisma.title.findMany).mockResolvedValue(rows);
    const forward = render(await MoodPage()).container.querySelector("img")!.getAttribute("src");

    mock(prisma.title.findMany).mockResolvedValue([...rows].reverse());
    const reversed = render(await MoodPage()).container.querySelector("img")!.getAttribute("src");

    expect(forward).toBe(reversed);
  });

  it("skips titles with no poster rather than rendering a broken image", async () => {
    mock(prisma.title.findMany).mockResolvedValue([
      pickerRow(["Weird"], true, { posterUrl: null, imdbScore: "9.9" }),
      pickerRow(["Weird"], true, { posterUrl: poster(2), imdbScore: "4.0" }),
    ]);

    render(await MoodPage());

    expect(screen.getByText("Weird").closest("a")!.querySelector("img")).toHaveAttribute("src", tileSrc(2));
  });

  // A title can be the highest-rated in several moods at once, which is
  // multi-tagging working correctly. Left unconstrained it showed the SAME image
  // on several tiles, so the assignment is global rather than per mood.
  it("never shows the same poster on two tiles", async () => {
    // One standout title carrying four moods, plus a weaker alternative in each.
    mock(prisma.title.findMany).mockResolvedValue([
      pickerRow(["Light & funny", "Feel-good", "Weird", "Beautiful & calm"], true, {
        posterUrl: poster(0),
        imdbScore: "9.5",
      }),
      pickerRow(["Light & funny"], true, { posterUrl: poster(1), imdbScore: "7.0" }),
      pickerRow(["Feel-good"], true, { posterUrl: poster(2), imdbScore: "7.0" }),
      pickerRow(["Weird"], true, { posterUrl: poster(3), imdbScore: "7.0" }),
      pickerRow(["Beautiful & calm"], true, { posterUrl: poster(4), imdbScore: "7.0" }),
    ]);

    const { container } = render(await MoodPage());

    const srcs = Array.from(container.querySelectorAll("img")).map((i) => i.getAttribute("src"));
    expect(srcs).toHaveLength(4);
    expect(new Set(srcs).size).toBe(4);
  });

  it("gives a contested title to the scarcest mood, not the abundant one", async () => {
    // The 9.5 is the best candidate for both moods. "Scary" has only that one;
    // "Dark & heavy" has three. Scarcest gets first refusal, so Scary keeps it
    // and Dark & heavy falls to its next best.
    mock(prisma.title.findMany).mockResolvedValue([
      pickerRow(["Scary", "Dark & heavy"], true, { posterUrl: poster(0), imdbScore: "9.5" }),
      pickerRow(["Dark & heavy"], true, { posterUrl: poster(1), imdbScore: "8.0" }),
      pickerRow(["Dark & heavy"], true, { posterUrl: poster(2), imdbScore: "7.0" }),
    ]);

    render(await MoodPage());

    expect(screen.getByText("Scary").closest("a")!.querySelector("img")).toHaveAttribute("src", tileSrc(0));
    expect(screen.getByText("Dark & heavy").closest("a")!.querySelector("img")).toHaveAttribute("src", tileSrc(1));
  });

  it("breaks count ties by canonical mood order, so assignment stays deterministic", async () => {
    // Both moods have exactly one candidate, the same title. Light & funny comes
    // first in canonical order, so it wins; Feel-good falls back to a duplicate
    // rather than a blank tile.
    mock(prisma.title.findMany).mockResolvedValue([
      pickerRow(["Light & funny", "Feel-good"], true, { posterUrl: poster(0), imdbScore: "8.0" }),
    ]);

    render(await MoodPage());

    expect(screen.getByText("Light & funny").closest("a")!.querySelector("img")).toHaveAttribute("src", tileSrc(0));
    // Fallback: a duplicate beats a hole.
    expect(screen.getByText("Feel-good").closest("a")!.querySelector("img")).toHaveAttribute("src", tileSrc(0));
  });

  it("keeps the assignment stable when rows arrive in a different order", async () => {
    const rows = [
      pickerRow(["Light & funny", "Feel-good"], true, { posterUrl: poster(0), imdbScore: "9.5" }),
      pickerRow(["Light & funny"], true, { posterUrl: poster(1), imdbScore: "7.0" }),
      pickerRow(["Feel-good"], true, { posterUrl: poster(2), imdbScore: "7.0" }),
      pickerRow(["Weird"], true, { posterUrl: poster(3), imdbScore: "7.0" }),
    ];
    const assignment = async (input: typeof rows) => {
      mock(prisma.title.findMany).mockResolvedValue(input);
      const { container } = render(await MoodPage());
      return Array.from(container.querySelectorAll("a[href^='/mood/']"))
        .map((a) => `${a.textContent}:${a.querySelector("img")?.getAttribute("src") ?? "none"}`)
        .join("|");
    };

    expect(await assignment(rows)).toBe(await assignment([...rows].reverse()));
  });

  it("renders no poster at all when a mood has no titles", async () => {
    mock(prisma.title.findMany).mockResolvedValue([
      pickerRow(["Weird"], true, { posterUrl: poster(1) }),
    ]);

    render(await MoodPage());

    expect(screen.getByText("Scary").closest("a")!.querySelector("img")).toBeNull();
  });

  // Same regression guard family as the results grid, plus the poster-wall
  // lesson: a uniform scrim rather than per-image opacity is what keeps light
  // and dark posters equally muted.
  it("renders posters eagerly, with a uniform scrim and no fade-in", async () => {
    mock(prisma.title.findMany).mockResolvedValue([
      pickerRow(["Weird"], true, { posterUrl: poster(1) }),
      pickerRow(["Scary"], true, { posterUrl: poster(2) }),
    ]);

    const { container } = render(await MoodPage());

    const html = container.innerHTML;
    expect(html).not.toContain('loading="lazy"');
    expect(container.querySelectorAll("img[loading]")).toHaveLength(0);
    expect(html).not.toContain("fade-in");
    // The scrim is a flat overlay, so no image carries an opacity class itself.
    for (const img of container.querySelectorAll("img")) {
      expect(img.className).not.toMatch(/opacity-/);
    }
    expect(html).toContain("bg-background/80");
    // The images really are present, so none of the above passes vacuously.
    expect(container.querySelectorAll("img")).toHaveLength(2);
  });

  it("singularises the untagged count", async () => {
    mock(prisma.title.findMany).mockResolvedValue([pickerRow([], false)]);
    render(await MoodPage());
    expect(screen.getByText("1 title not yet tagged")).toBeInTheDocument();
  });
});

describe("/mood accessibility", () => {
  it("announces each tile as a label plus a counted unit", async () => {
    // The tile shows "Dark & heavy" above a bare "102", which reads as
    // "Dark & heavy 102" with no unit unless the link carries its own name.
    mock(prisma.title.findMany).mockResolvedValue([
      pickerRow(["Dark & heavy"]),
      pickerRow(["Dark & heavy"]),
      pickerRow(["Weird"]),
    ]);

    render(await MoodPage());

    expect(screen.getByRole("link", { name: "Dark & heavy, 2 titles" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Weird, 1 title" })).toBeInTheDocument();
  });

  it("announces an empty mood as having no titles, not as a dash", async () => {
    mock(prisma.title.findMany).mockResolvedValue([pickerRow(["Weird"])]);

    render(await MoodPage());

    const scary = screen.getByRole("link", { name: "Scary, no titles" });
    expect(scary).toBeInTheDocument();
    // The en dash stands in for a number visually and says nothing aloud.
    expect(scary.querySelector("[aria-hidden='true']")?.textContent?.trim()).toBe("–");
  });

  it("gives every tile a keyboard focus ring and a real tap target", async () => {
    mock(prisma.title.findMany).mockResolvedValue([pickerRow(["Weird"])]);

    const { container } = render(await MoodPage());

    const tiles = container.querySelectorAll("a[href^='/mood/']");
    expect(tiles).toHaveLength(12);
    for (const tile of tiles) {
      // The codebase's standard treatment, not a bespoke one.
      expect(tile.className).toContain("focus-visible:ring-foreground");
      // 5.5rem = 88px, comfortably over the 44px minimum.
      expect(tile.className).toContain("min-h-[5.5rem]");
    }
  });

  it("keeps the poster backgrounds out of the accessibility tree", async () => {
    mock(prisma.title.findMany).mockResolvedValue([
      pickerRow(["Weird"], true, { posterUrl: poster(1) }),
    ]);

    const { container } = render(await MoodPage());

    const img = container.querySelector("img")!;
    // Decorative twice over: an empty alt, inside an aria-hidden wrapper.
    expect(img).toHaveAttribute("alt", "");
    expect(img.closest("[aria-hidden='true']")).not.toBeNull();
  });

  it("labels the back link", async () => {
    mock(prisma.title.findMany).mockResolvedValue([]);
    render(await MoodPage());
    expect(screen.getByRole("link", { name: "Back to watchlist" })).toBeInTheDocument();
  });
});

describe("/mood/[slug] grid", () => {
  const params = (slug: string) => Promise.resolve({ slug });

  it("renders one card per matching title, linking to the detail page", async () => {
    mock(prisma.title.findMany).mockResolvedValue([cardRow(1), cardRow(2)]);

    const { container } = render(await MoodTitlesPage({ params: params("edge-of-seat") }));

    expect(screen.getByText("Edge-of-seat")).toBeInTheDocument();
    expect(screen.getByText("2 titles")).toBeInTheDocument();
    const hrefs = Array.from(container.querySelectorAll("a[href^='/title/']")).map((a) =>
      a.getAttribute("href"),
    );
    expect(hrefs).toEqual(["/title/id1", "/title/id2"]);
  });

  it("filters by the mood label and orders like the Want list", async () => {
    mock(prisma.title.findMany).mockResolvedValue([]);

    await MoodTitlesPage({ params: params("beautiful-calm") });

    const arg = mock(prisma.title.findMany).mock.calls[0][0];
    expect(arg.where).toEqual({ status: "WANT", moods: { has: "Beautiful & calm" } });
    // Same ordering as listTitles()'s Want branch.
    expect(arg.orderBy).toEqual([{ pinned: "desc" }, { pinnedAt: "desc" }, { addedAt: "desc" }]);
  });

  it("shows a clean empty state and no cards for a mood with no matches", async () => {
    mock(prisma.title.findMany).mockResolvedValue([]);

    const { container } = render(await MoodTitlesPage({ params: params("scary") }));

    expect(screen.getByText("Nothing here yet")).toBeInTheDocument();
    expect(container.querySelectorAll("a[href^='/title/']")).toHaveLength(0);
    expect(screen.queryByText(/titles$/)).not.toBeInTheDocument();
  });

  it("singularises a single match", async () => {
    mock(prisma.title.findMany).mockResolvedValue([cardRow(1)]);
    render(await MoodTitlesPage({ params: params("weird") }));
    expect(screen.getByText("1 title")).toBeInTheDocument();
  });

  it("calls notFound for the retired tense-gripping slug", async () => {
    // The mood was split into Slow-burn dread and Edge-of-seat; its old URL
    // must 404 rather than silently render an empty grid.
    await MoodTitlesPage({ params: params("tense-gripping") }).catch(() => {});

    expect(notFoundSpy).toHaveBeenCalled();
    expect(prisma.title.findMany).not.toHaveBeenCalled();
  });

  it("calls notFound for an unknown slug, without querying", async () => {
    await MoodTitlesPage({ params: params("melancholy") }).catch(() => {});

    expect(notFoundSpy).toHaveBeenCalled();
    expect(prisma.title.findMany).not.toHaveBeenCalled();
  });

  // REGRESSION GUARD for the two poster-flash fixes. Both were found by bisect
  // and both are easy to reintroduce by "helpfully" copying Home's markup.
  it("renders no loading=lazy and no fade-in", async () => {
    mock(prisma.title.findMany).mockResolvedValue([cardRow(1), cardRow(2), cardRow(3)]);

    const { container } = render(await MoodTitlesPage({ params: params("weird") }));

    const html = container.innerHTML;
    // lazy loading defers the poster a frame past layout, which blanked the grid
    // on back-navigation.
    expect(html).not.toContain('loading="lazy"');
    expect(container.querySelectorAll("img[loading]")).toHaveLength(0);
    // fade-in covers hydration of a client-cached list; this markup is
    // server-rendered and complete on the first frame, so a fade would create
    // the flash it exists to hide.
    expect(html).not.toContain("fade-in");
    // The posters really are in the markup, so the assertions above are not
    // passing on an empty grid.
    expect(container.querySelectorAll("img")).toHaveLength(3);
  });
});
