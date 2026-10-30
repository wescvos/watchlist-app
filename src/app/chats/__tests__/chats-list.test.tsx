import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { ChatsList } from "@/app/chats/ChatsList";

const recent = new Date(Date.now() - 2 * 60_000).toISOString();
const convos = [
  { id: "c1", other: { id: "u1", firstName: "Anna", image: null }, otherActive: true, lastMessageAt: recent, preview: "Watch The Matrix", unread: true },
  { id: "c2", other: { id: "u2", firstName: "Bram", image: null }, otherActive: true, lastMessageAt: recent, preview: "Sent a movie", unread: false },
];
const people = [
  { id: "u1", firstName: "Anna", image: null },
  { id: "u2", firstName: "Bram", image: null },
  { id: "u3", firstName: "Cleo", image: null },
];

let fetchMock: ReturnType<typeof vi.fn>;
function mockFetch(c: unknown, p: unknown = people, ok = true) {
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ id: "new1" }) });
    }
    const body = url === "/api/chat/people" ? p : c;
    return Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) });
  });
  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("ChatsList", () => {
  it("renders rows in API order with a dot only on unread, linking to the chat", async () => {
    mockFetch(convos);
    render(<ChatsList />);
    await screen.findByText("Watch The Matrix");
    const links = screen.getAllByRole("link").filter((l) => l.getAttribute("href")?.startsWith("/chats/"));
    expect(links.map((l) => l.getAttribute("href"))).toEqual(["/chats/c1", "/chats/c2"]);
    expect(screen.getAllByText("2m")).toHaveLength(2);
    expect(screen.getAllByTestId("unread-dot")).toHaveLength(1);
    expect(links[0].querySelector('[data-testid="unread-dot"]')).not.toBeNull();
    expect(document.body.textContent).not.toContain("\u2764");
  });

  it("lists only people without a conversation and navigates after POST", async () => {
    mockFetch(convos);
    render(<ChatsList />);
    await screen.findByText("Start a new chat");
    expect(screen.queryByRole("button", { name: /Anna/ })).toBeNull();
    fireEvent.click(await screen.findByRole("button", { name: /Cleo/ }));
    await waitFor(() => expect(push).toHaveBeenCalledWith("/chats/new1"));
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST");
    expect(post?.[0]).toBe("/api/chat/conversations");
    expect(JSON.parse(post?.[1].body)).toEqual({ otherUserId: "u3" });
  });

  it("shows the empty copy", async () => {
    mockFetch([], []);
    render(<ChatsList />);
    expect(await screen.findByText("No chats yet. Send someone a movie from any title page.")).toBeInTheDocument();
  });

  it("shows an inline error with Retry", async () => {
    mockFetch([], [], false);
    render(<ChatsList />);
    const retry = await screen.findByRole("button", { name: "Retry" });
    mockFetch(convos);
    fireEvent.click(retry);
    await screen.findByText("Watch The Matrix");
  });
});
