import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";

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
function mockFetch(c: unknown, p: unknown = people, ok = true, peopleOk = ok) {
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (init?.method === "POST") {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({ id: "new1" }) });
    }
    const isPeople = url === "/api/chat/people";
    const good = isPeople ? peopleOk : ok;
    return Promise.resolve({ ok: good, status: good ? 200 : 500, json: () => Promise.resolve(isPeople ? p : c) });
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

  it("loads people once on mount, not on every poll", async () => {
    mockFetch(convos);
    render(<ChatsList />);
    await screen.findByText("Start a new chat");
    const calls = (url: string) => fetchMock.mock.calls.filter((c) => c[0] === url).length;
    for (let i = 0; i < 2; i++) {
      await act(async () => {
        document.dispatchEvent(new Event("visibilitychange"));
      });
    }
    await waitFor(() => expect(calls("/api/chat/conversations")).toBe(3));
    expect(calls("/api/chat/people")).toBe(1);
  });

  it("still shows the chats when loading people fails", async () => {
    mockFetch(convos, people, true, false);
    render(<ChatsList />);
    await screen.findByText("Watch The Matrix");
    await waitFor(() => expect(fetchMock.mock.calls.some((c) => c[0] === "/api/chat/people")).toBe(true));
    await act(async () => {});
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Start a new chat")).toBeNull();
  });
});
