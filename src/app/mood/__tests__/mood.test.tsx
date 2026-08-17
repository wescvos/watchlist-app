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
function pickerRow(moods: string[], tagged = true) {
  return { moods, moodsTaggedAt: tagged ? new Date("2026-08-17") : null };
}

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
  it("renders all eleven moods in canonical order", async () => {
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
      pickerRow(["Tense & gripping", "Dark & heavy"]),
      pickerRow(["Tense & gripping"]),
      pickerRow(["Weird"]),
    ]);

    render(await MoodPage());

    // One query for the whole screen, not one per mood.
    expect(prisma.title.findMany).toHaveBeenCalledTimes(1);
    const tense = screen.getByText("Tense & gripping").closest("a")!;
    expect(tense).toHaveTextContent("2");
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
    expect(scary).toHaveTextContent("none");
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

  it("singularises the untagged count", async () => {
    mock(prisma.title.findMany).mockResolvedValue([pickerRow([], false)]);
    render(await MoodPage());
    expect(screen.getByText("1 title not yet tagged")).toBeInTheDocument();
  });
});

describe("/mood/[slug] grid", () => {
  const params = (slug: string) => Promise.resolve({ slug });

  it("renders one card per matching title, linking to the detail page", async () => {
    mock(prisma.title.findMany).mockResolvedValue([cardRow(1), cardRow(2)]);

    const { container } = render(await MoodTitlesPage({ params: params("tense-gripping") }));

    expect(screen.getByText("Tense & gripping")).toBeInTheDocument();
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
