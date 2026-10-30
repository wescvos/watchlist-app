import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/currentUser", () => ({ getCurrentUserId: vi.fn() }));
vi.mock("@/lib/chat/people", () => ({ listPeople: vi.fn(), isActiveUser: vi.fn() }));
vi.mock("@/lib/chat/conversations", () => ({
  getOrCreateConversation: vi.fn(),
  listConversations: vi.fn(),
  markRead: vi.fn(),
  unreadCount: vi.fn(),
}));
// Keep the real ChatInputError so instanceof works in the routes.
vi.mock("@/lib/chat/messages", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/chat/messages")>();
  return {
    ChatInputError: actual.ChatInputError,
    getMessages: vi.fn(),
    sendText: vi.fn(),
    sendTitle: vi.fn(),
    setHeart: vi.fn(),
  };
});
vi.mock("@/lib/prisma", () => ({ prisma: {} }));

import { getCurrentUserId } from "@/lib/currentUser";
import { listPeople, isActiveUser } from "@/lib/chat/people";
import { getOrCreateConversation, listConversations, markRead, unreadCount } from "@/lib/chat/conversations";
import { ChatInputError, getMessages, sendText, sendTitle, setHeart } from "@/lib/chat/messages";
import { GET as peopleGet } from "@/app/api/chat/people/route";
import { GET as unreadGet } from "@/app/api/chat/unread/route";
import { GET as convList, POST as convPost } from "@/app/api/chat/conversations/route";
import { GET as msgGet, POST as msgPost } from "@/app/api/chat/conversations/[id]/messages/route";
import { POST as readPost } from "@/app/api/chat/conversations/[id]/read/route";
import { POST as heartPost } from "@/app/api/chat/messages/[id]/heart/route";
import { POST as sendPost } from "@/app/api/chat/send/route";

const ctx = { params: Promise.resolve({ id: "c1" }) };
const post = (body: unknown) =>
  new Request("http://x/api", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) });
const get = (qs = "") => new Request(`http://x/api${qs}`);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentUserId).mockResolvedValue("u1");
});

describe("unauthenticated", () => {
  const cases: [string, () => Promise<Response>][] = [
    ["people", () => peopleGet()],
    ["unread", () => unreadGet()],
    ["conv list", () => convList()],
    ["conv post", () => convPost(post({ otherUserId: "u2" }))],
    ["msg get", () => msgGet(get(), ctx)],
    ["msg post", () => msgPost(post({ text: "hi" }), ctx)],
    ["read", () => readPost(post({}), ctx)],
    ["heart", () => heartPost(post({ hearted: true }), ctx)],
    ["send", () => sendPost(post({ recipientIds: ["u2"], tmdbId: 1, mediaType: "MOVIE" }))],
  ];
  it.each(cases)("%s returns 401 with no data call", async (_n, call) => {
    vi.mocked(getCurrentUserId).mockResolvedValue(null);
    const res = await call();
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
    for (const m of [listPeople, isActiveUser, getOrCreateConversation, listConversations, markRead, unreadCount, getMessages, sendText, sendTitle, setHeart]) {
      expect(m).not.toHaveBeenCalled();
    }
  });
});

describe("happy paths", () => {
  it("people", async () => {
    vi.mocked(listPeople).mockResolvedValue([{ id: "u2", firstName: "A", image: null }]);
    const res = await peopleGet();
    expect(await res.json()).toEqual([{ id: "u2", firstName: "A", image: null }]);
    expect(listPeople).toHaveBeenCalledWith("u1");
  });
  it("unread", async () => {
    vi.mocked(unreadCount).mockResolvedValue(3);
    expect(await (await unreadGet()).json()).toEqual({ count: 3 });
  });
  it("conversation list", async () => {
    vi.mocked(listConversations).mockResolvedValue([]);
    expect(await (await convList()).json()).toEqual([]);
  });
  it("conversation create", async () => {
    vi.mocked(isActiveUser).mockResolvedValue(true);
    vi.mocked(getOrCreateConversation).mockResolvedValue({ id: "c9" });
    const res = await convPost(post({ otherUserId: "u2" }));
    expect(await res.json()).toEqual({ id: "c9" });
    expect(getOrCreateConversation).toHaveBeenCalledWith("u1", "u2");
  });
  it("messages get passes before", async () => {
    vi.mocked(getMessages).mockResolvedValue({ messages: [], hasEarlier: false, otherLastReadAt: null });
    const res = await msgGet(get("?before=m5"), ctx);
    expect(res.status).toBe(200);
    expect(getMessages).toHaveBeenCalledWith("u1", "c1", "m5");
  });
  it("messages post", async () => {
    vi.mocked(sendText).mockResolvedValue({ id: "m1" } as never);
    const res = await msgPost(post({ text: "hi" }), ctx);
    expect(await res.json()).toEqual({ id: "m1" });
    expect(sendText).toHaveBeenCalledWith("u1", "c1", "hi");
  });
  it("read", async () => {
    vi.mocked(markRead).mockResolvedValue(true);
    expect(await (await readPost(post({}), ctx)).json()).toEqual({ ok: true });
  });
  it("heart", async () => {
    vi.mocked(setHeart).mockResolvedValue({ hearted: true });
    expect(await (await heartPost(post({ hearted: true }), ctx)).json()).toEqual({ hearted: true });
    expect(setHeart).toHaveBeenCalledWith("u1", "c1", true);
    vi.mocked(setHeart).mockResolvedValue({ hearted: false });
    expect(await (await heartPost(post({ hearted: false }), ctx)).json()).toEqual({ hearted: false });
    expect(setHeart).toHaveBeenLastCalledWith("u1", "c1", false);
  });
  it("send", async () => {
    vi.mocked(sendTitle).mockResolvedValue({ conversationIds: ["c1"] });
    const res = await sendPost(post({ recipientIds: ["u2"], tmdbId: 5, mediaType: "TV", text: "watch" }));
    expect(await res.json()).toEqual({ conversationIds: ["c1"] });
    expect(sendTitle).toHaveBeenCalledWith("u1", { recipientIds: ["u2"], tmdbId: 5, mediaType: "TV", text: "watch" });
  });
});

describe("404 mapping", () => {
  it("messages get", async () => {
    vi.mocked(getMessages).mockResolvedValue(null);
    const res = await msgGet(get(), ctx);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "Not found" });
  });
  it("messages post", async () => {
    vi.mocked(sendText).mockResolvedValue(null);
    expect((await msgPost(post({ text: "hi" }), ctx)).status).toBe(404);
  });
  it("read", async () => {
    vi.mocked(markRead).mockResolvedValue(false);
    expect((await readPost(post({}), ctx)).status).toBe(404);
  });
  it("heart", async () => {
    vi.mocked(setHeart).mockResolvedValue(null);
    expect((await heartPost(post({ hearted: true }), ctx)).status).toBe(404);
  });
});

describe("400 mapping", () => {
  it("ChatInputError from sendText", async () => {
    vi.mocked(sendText).mockRejectedValue(new ChatInputError("Write a message first."));
    const res = await msgPost(post({ text: "  " }), ctx);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Write a message first." });
  });
  it("ChatInputError from sendTitle", async () => {
    vi.mocked(sendTitle).mockRejectedValue(new ChatInputError("Pick at least one person."));
    const res = await sendPost(post({ recipientIds: [], tmdbId: 1, mediaType: "MOVIE" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Pick at least one person." });
  });
  it("malformed JSON", async () => {
    for (const call of [
      () => convPost(post("{nope")),
      () => msgPost(post("{nope"), ctx),
      () => sendPost(post("{nope")),
      () => heartPost(post("{nope"), ctx),
    ]) {
      expect((await call()).status).toBe(400);
    }
  });
  it("wrong field types", async () => {
    expect((await convPost(post({ otherUserId: 5 }))).status).toBe(400);
    expect((await msgPost(post({ text: 5 }), ctx)).status).toBe(400);
    const bad = [
      { recipientIds: "u2", tmdbId: 1, mediaType: "MOVIE" },
      { recipientIds: [1], tmdbId: 1, mediaType: "MOVIE" },
      { recipientIds: ["u2"], tmdbId: "1", mediaType: "MOVIE" },
      { recipientIds: ["u2"], tmdbId: 0, mediaType: "MOVIE" },
      { recipientIds: ["u2"], tmdbId: 1.5, mediaType: "MOVIE" },
      { recipientIds: ["u2"], tmdbId: 1, mediaType: "movie" },
      { recipientIds: ["u2"], tmdbId: 1, mediaType: "MOVIE", text: 4 },
    ];
    for (const b of bad) expect((await sendPost(post(b))).status).toBe(400);
    for (const b of [{}, { hearted: "true" }, { hearted: 1 }, { hearted: null }]) {
      const res = await heartPost(post(b), ctx);
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "hearted must be a boolean" });
    }
    expect(setHeart).not.toHaveBeenCalled();
    expect(sendTitle).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
  });
  it("conversation with self or inactive user", async () => {
    let res = await convPost(post({ otherUserId: "u1" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "You can't start a chat with yourself." });
    vi.mocked(isActiveUser).mockResolvedValue(false);
    res = await convPost(post({ otherUserId: "u2" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "This person is not on Watchlist." });
    expect(getOrCreateConversation).not.toHaveBeenCalled();
  });
});

describe("unexpected errors", () => {
  it("returns 500 and logs", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    vi.mocked(listPeople).mockRejectedValue(new Error("boom"));
    const res = await peopleGet();
    expect(res.status).toBe(500);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});
