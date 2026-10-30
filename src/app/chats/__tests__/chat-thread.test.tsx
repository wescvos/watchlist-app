import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, act } from "@testing-library/react";
import type { ChatMessage, ChatPage } from "@/lib/chat/messages";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

import { ChatThread } from "@/app/chats/[id]/ChatThread";
import { ChatTitleCard } from "@/components/ChatTitleCard";

const ME = "me";
const OTHER = { id: "u1", firstName: "Anna", image: null };

function at(n: number) {
  return new Date(Date.UTC(2026, 9, 1, 12, 0, n)).toISOString();
}

function msg(n: number, over: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: `m${String(n).padStart(3, "0")}`,
    senderId: n % 2 ? OTHER.id : ME,
    createdAt: at(n),
    text: `msg ${n}`,
    title: null,
    senderRating: null,
    viewerStatus: null,
    heartedBy: [],
    ...over,
  };
}

function range(from: number, to: number) {
  return Array.from({ length: to - from + 1 }, (_, i) => msg(from + i));
}

const title = { id: "t1", tmdbId: 603, mediaType: "MOVIE" as const, title: "The Matrix", year: 1999, posterUrl: null };

type Responder = (url: string, init?: RequestInit) => { ok?: boolean; status?: number; body: unknown } | undefined;
let fetchMock: ReturnType<typeof vi.fn>;
function mockFetch(respond: Responder) {
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    const r = respond(url, init) ?? { body: { ok: true } };
    const ok = r.ok ?? true;
    return Promise.resolve({ ok, status: r.status ?? (ok ? 200 : 400), json: () => Promise.resolve(r.body) });
  });
  vi.stubGlobal("fetch", fetchMock);
}

function page(messages: ChatMessage[], over: Partial<ChatPage> = {}): ChatPage {
  return { messages, hasEarlier: false, otherLastReadAt: null, ...over };
}

function renderThread(initial: ChatPage, otherActive = true) {
  return render(
    <ChatThread conversationId="c1" meId={ME} other={OTHER} otherActive={otherActive} initialPage={initial} />,
  );
}

// usePolling skips a tick while the previous one is in flight, so let the
// mount tick settle before firing the next one via visibilitychange.
async function poll() {
  await act(async () => {});
  await act(async () => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.unstubAllGlobals());

describe("ChatTitleCard", () => {
  it("credits the rating to the sender, or to you on your own cards", () => {
    const { rerender } = render(
      <ChatTitleCard title={title} senderRating={8} viewerStatus={null} raterName="Anna" />,
    );
    expect(screen.getByText("Anna rated it 8/10")).toBeInTheDocument();
    rerender(<ChatTitleCard title={title} senderRating={8} viewerStatus={null} raterName="You" />);
    expect(screen.getByText("You rated it 8/10")).toBeInTheDocument();
    rerender(<ChatTitleCard title={title} senderRating={null} viewerStatus={null} raterName="You" />);
    expect(screen.queryByText(/rated it/)).toBeNull();
  });

  it("links to the title page when listed, else the preview", () => {
    const { rerender } = render(
      <ChatTitleCard title={title} senderRating={null} viewerStatus="WANT" raterName="Anna" />,
    );
    expect(screen.getByRole("link")).toHaveAttribute("href", "/title/t1");
    expect(screen.getByText("On your Want list")).toBeInTheDocument();
    rerender(<ChatTitleCard title={title} senderRating={null} viewerStatus="WATCHED" raterName="Anna" />);
    expect(screen.getByText("On your Watched list")).toBeInTheDocument();
    rerender(<ChatTitleCard title={title} senderRating={null} viewerStatus={null} raterName="Anna" />);
    expect(screen.getByRole("link")).toHaveAttribute("href", "/preview/movie/603");
    expect(screen.queryByText(/On your/)).toBeNull();
  });
});

describe("ChatThread", () => {
  it("shows Seen only under my latest message, and only once read", () => {
    mockFetch((url) => (url.endsWith("/messages") ? { body: page([msg(1), msg(2), msg(4), msg(5)]) } : undefined));
    const messages = [msg(1), msg(2), msg(4), msg(5)];
    const { unmount } = renderThread(page(messages, { otherLastReadAt: at(3) }));
    // My latest is msg 4 (at 4s), read at 3s: not seen yet.
    expect(screen.queryByText("Seen")).toBeNull();
    unmount();

    renderThread(page(messages, { otherLastReadAt: at(4) }));
    const seen = screen.getAllByText("Seen");
    expect(seen).toHaveLength(1);
    expect(seen[0].closest("[data-message-id]")).toHaveAttribute("data-message-id", "m004");
  });

  it("toggles the heart after a double tap", async () => {
    mockFetch((url, init) => {
      if (url === "/api/chat/messages/m001/heart" && init?.method === "POST") return { body: { hearted: true } };
      if (url.endsWith("/messages")) return { body: page([msg(1)]) };
      return undefined;
    });
    renderThread(page([msg(1)]));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const bubble = screen.getByText("msg 1");
    fireEvent.click(bubble, { detail: 1 });
    expect(screen.queryByRole("img", { name: "Hearted" })).toBeNull();
    fireEvent.click(bubble, { detail: 2 });
    expect(await screen.findByRole("img", { name: "Hearted" })).toBeInTheDocument();
    await waitFor(() =>
      expect(fetchMock.mock.calls.some((c) => c[0] === "/api/chat/messages/m001/heart")).toBe(true),
    );
  });

  it("double-tapping a card hearts it and does not navigate", async () => {
    vi.useFakeTimers();
    try {
      const card = msg(1, { text: null, title, viewerStatus: "WANT" });
      mockFetch((url) => {
        if (url.endsWith("/heart")) return { body: { hearted: true } };
        if (url.endsWith("/messages")) return { body: page([card]) };
        return undefined;
      });
      renderThread(page([card]));
      const link = screen.getByRole("link", { name: /The Matrix/ });
      fireEvent.click(link, { detail: 1 });
      fireEvent.click(link, { detail: 2 });
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(push).not.toHaveBeenCalled();
      expect(screen.getByRole("img", { name: "Hearted" })).toBeInTheDocument();

      fireEvent.click(link, { detail: 1 });
      await act(async () => {
        vi.advanceTimersByTime(1000);
      });
      expect(push).toHaveBeenCalledWith("/title/t1");
    } finally {
      vi.useRealTimers();
    }
  });

  it("a poll of the newest 50 keeps earlier pages and adds no duplicates", async () => {
    let newest = range(51, 100);
    mockFetch((url) => {
      if (url.includes("before=m051")) return { body: page(range(1, 50), { hasEarlier: false }) };
      if (url === "/api/chat/conversations/c1/messages") return { body: page(newest, { hasEarlier: true }) };
      return undefined;
    });
    renderThread(page(range(51, 100), { hasEarlier: true }));
    fireEvent.click(screen.getByRole("button", { name: "Load earlier" }));
    await screen.findByText("msg 1");
    expect(screen.queryByRole("button", { name: "Load earlier" })).toBeNull();

    newest = range(52, 101);
    await poll();
    await screen.findByText("msg 101");
    for (const n of [1, 50, 51, 52, 100, 101]) expect(screen.getAllByText(`msg ${n}`)).toHaveLength(1);
    expect(document.querySelectorAll("[data-message-id]")).toHaveLength(101);
  });

  it("a poll updates hearts on messages it returns, including removed ones", async () => {
    let newest = [msg(1, { heartedBy: [ME] })];
    mockFetch((url) => (url.endsWith("/messages") ? { body: page(newest) } : undefined));
    renderThread(page([msg(1, { heartedBy: [ME] })]));
    expect(screen.getByRole("img", { name: "Hearted" })).toBeInTheDocument();
    newest = [msg(1)];
    await poll();
    await waitFor(() => expect(screen.queryByRole("img", { name: "Hearted" })).toBeNull());
  });

  it("marks read on open and after a poll brings a new message from them", async () => {
    let newest = [msg(1)];
    mockFetch((url) => (url.endsWith("/messages") ? { body: page(newest) } : undefined));
    renderThread(page([msg(1)]));
    const reads = () => fetchMock.mock.calls.filter((c) => c[0] === "/api/chat/conversations/c1/read").length;
    await waitFor(() => expect(reads()).toBe(1));
    newest = [msg(1), msg(3)];
    await poll();
    await screen.findByText("msg 3");
    await waitFor(() => expect(reads()).toBe(2));
  });

  it("hides the input when the other person is gone", () => {
    mockFetch(() => undefined);
    renderThread(page([msg(1)]), false);
    expect(screen.getByText("This person is no longer on Watchlist.")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
  });

  it("sends optimistically and reconciles with the server message", async () => {
    mockFetch((url, init) => {
      if (url.endsWith("/messages") && init?.method === "POST") return { body: msg(2, { text: "hello there" }) };
      if (url.endsWith("/messages")) return { body: page([msg(1)]) };
      return undefined;
    });
    renderThread(page([msg(1)]));
    const box = screen.getByRole("textbox");
    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toBeDisabled();
    fireEvent.change(box, { target: { value: "  hello there " } });
    expect(send).toBeEnabled();
    fireEvent.click(send);
    expect(screen.getByText("hello there")).toBeInTheDocument();
    expect(box).toHaveValue("");
    await waitFor(() => expect(document.querySelector('[data-message-id="m002"]')).not.toBeNull());
    expect(screen.getAllByText("hello there")).toHaveLength(1);
    const post = fetchMock.mock.calls.find((c) => c[1]?.method === "POST" && c[0].endsWith("/messages"));
    expect(JSON.parse(post?.[1].body)).toEqual({ text: "hello there" });
  });

  it("restores the text and shows the error when sending fails", async () => {
    mockFetch((url, init) => {
      if (url.endsWith("/messages") && init?.method === "POST") {
        return { ok: false, status: 400, body: { error: "This person is no longer on Watchlist." } };
      }
      if (url.endsWith("/messages")) return { body: page([msg(1)]) };
      return undefined;
    });
    renderThread(page([msg(1)]));
    const box = screen.getByRole("textbox");
    fireEvent.change(box, { target: { value: "hello" } });
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("This person is no longer on Watchlist.")).toBeInTheDocument();
    expect(box).toHaveValue("hello");
    expect(screen.queryByText("hello", { selector: "p" })).toBeNull();
  });
});
