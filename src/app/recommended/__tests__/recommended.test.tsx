import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import RecommendedPage from "@/app/recommended/page";
import type { ResolvedSuggestion } from "@/lib/recommend/types";

function suggestion(tmdbId: number, title: string, mediaType: "MOVIE" | "TV" = "MOVIE"): ResolvedSuggestion {
  // A poster so the title renders once (in the caption), not also in the
  // no-poster fallback tile.
  return { tmdbId, mediaType, title, year: 2020, posterUrl: `https://img/${tmdbId}.jpg`, reason: `why ${title}` };
}

function recSet(suggestions: ResolvedSuggestion[]) {
  return { id: "s1", suggestions, model: "gemini-2.5-flash", sourceCount: 5, generatedAt: "2026-07-20T10:00:00.000Z" };
}

type FetchResult = { ok: boolean; status?: number; body: unknown };

// Route fetch by method: GET (mount) vs POST (refresh).
function installFetch(routes: { get?: FetchResult; post?: FetchResult }) {
  const mock = vi.fn(async (_url: string, init?: { method?: string }) => {
    const r = (init?.method === "POST" ? routes.post : routes.get) ?? { ok: true, body: null };
    return { ok: r.ok, status: r.status ?? (r.ok ? 200 : 500), json: async () => r.body } as unknown as Response;
  });
  vi.stubGlobal("fetch", mock as unknown as typeof fetch);
  return mock;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("Recommended screen", () => {
  it("renders the cached set instantly, with cards linking into the preview/add flow", async () => {
    installFetch({ get: { ok: true, body: recSet([suggestion(10, "Sicario"), suggestion(20, "Fargo", "TV")]) } });
    render(<RecommendedPage />);

    expect(await screen.findByText("Sicario")).toBeInTheDocument();
    expect(screen.getByText("Fargo")).toBeInTheDocument();
    expect(screen.getByText(/Generated/)).toBeInTheDocument();

    const links = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(links).toContain("/preview/movie/10");
    expect(links).toContain("/preview/tv/20");
  });

  it("keeps the existing cached set (does not blank) when a refresh fails", async () => {
    installFetch({
      get: { ok: true, body: recSet([suggestion(10, "Sicario")]) },
      post: { ok: false, status: 502, body: { error: "nope" } },
    });
    render(<RecommendedPage />);
    await screen.findByText("Sicario");

    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));

    await waitFor(() => expect(screen.getByText(/Showing your last set/i)).toBeInTheDocument());
    // The card is still there — the failed refresh did not wipe it.
    expect(screen.getByText("Sicario")).toBeInTheDocument();
  });

  it("shows the rate-first state (not an error) when POST returns 200 { empty: true }", async () => {
    installFetch({
      get: { ok: true, body: null }, // nothing generated yet → first-run
      post: { ok: true, body: { empty: true } },
    });
    render(<RecommendedPage />);

    const generate = await screen.findByRole("button", { name: /generate recommendations/i });
    await act(async () => {
      fireEvent.click(generate);
    });

    expect(await screen.findByText(/Rate some watched titles first/i)).toBeInTheDocument();
    expect(screen.queryByText(/Showing your last set/i)).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("shows a distinct rate-limit message on a 429 and keeps the cached set", async () => {
    installFetch({
      get: { ok: true, body: recSet([suggestion(10, "Sicario")]) },
      post: { ok: false, status: 429, body: { error: "limit" } },
    });
    render(<RecommendedPage />);
    await screen.findByText("Sicario");

    fireEvent.click(screen.getByRole("button", { name: /refresh/i }));

    await waitFor(() => expect(screen.getByText(/today's recommendation limit/i)).toBeInTheDocument());
    expect(screen.queryByText(/Showing your last set/i)).not.toBeInTheDocument();
    expect(screen.getByText("Sicario")).toBeInTheDocument();
  });

  it("dismisses a card: removes it optimistically and POSTs the dismissal", async () => {
    const fetchMock = installFetch({
      get: { ok: true, body: recSet([suggestion(10, "Sicario"), suggestion(20, "Fargo", "TV")]) },
      post: { ok: true, body: { ok: true } },
    });
    render(<RecommendedPage />);
    await screen.findByText("Sicario");

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /not interested in Sicario/i }));
    });

    // Card gone from view…
    expect(screen.queryByText("Sicario")).not.toBeInTheDocument();
    expect(screen.getByText("Fargo")).toBeInTheDocument();
    // …and the dismissal was recorded with the right key.
    const dismissCall = fetchMock.mock.calls.find(
      ([url, init]) => String(url).endsWith("/dismiss") && (init as { method?: string })?.method === "POST",
    );
    expect(dismissCall).toBeTruthy();
    expect(JSON.parse(String((dismissCall![1] as { body?: unknown }).body))).toEqual({ tmdbId: 10, mediaType: "MOVIE" });
  });
});
