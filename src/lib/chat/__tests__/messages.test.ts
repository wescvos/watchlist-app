import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversation: { upsert: vi.fn(), update: vi.fn() },
    message: { create: vi.fn(), findMany: vi.fn(), findFirst: vi.fn(), findUnique: vi.fn() },
    reaction: { upsert: vi.fn(), deleteMany: vi.fn() },
    listEntry: { findUnique: vi.fn(), findMany: vi.fn(), create: vi.fn(), upsert: vi.fn() },
    $transaction: vi.fn(async (ops: unknown[]) => ops),
  },
}));
vi.mock("@/lib/chat/people", () => ({ isActiveUser: vi.fn() }));
vi.mock("@/lib/chat/conversations", async () => {
  const actual = await vi.importActual<typeof import("@/lib/chat/conversations")>(
    "@/lib/chat/conversations",
  );
  return { ...actual, getOrCreateConversation: vi.fn(), getConversationForUser: vi.fn() };
});
vi.mock("@/lib/titles", () => ({ ensureCatalogTitle: vi.fn() }));

import { prisma } from "@/lib/prisma";
import { isActiveUser } from "@/lib/chat/people";
import { getOrCreateConversation, getConversationForUser } from "@/lib/chat/conversations";
import { ensureCatalogTitle } from "@/lib/titles";
import {
  ChatInputError,
  getMessages,
  sendText,
  sendTitle,
  setHeart,
  PAGE_SIZE,
} from "@/lib/chat/messages";

const m = vi.mocked;
const conv = (over: Record<string, unknown> = {}) => ({
  id: "c1",
  other: { id: "z", firstName: "Zed", image: null },
  otherActive: true,
  myLastReadAt: null,
  otherLastReadAt: null,
  ...over,
});
const catalog = {
  id: "t1",
  tmdbId: 5,
  mediaType: "MOVIE",
  title: "Heat",
  year: 1995,
  posterUrl: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  m(prisma.$transaction).mockImplementation((async (ops: unknown[]) => ops) as never);
  m(isActiveUser).mockResolvedValue(true);
  m(getConversationForUser).mockResolvedValue(conv() as never);
  m(prisma.message.create).mockImplementation(((a: { data: Record<string, unknown> }) => ({
    id: "m-new",
    reactions: [],
    title: null,
    titleId: null,
    text: null,
    senderRating: null,
    ...a.data,
  })) as never);
  m(prisma.listEntry.findMany).mockResolvedValue([] as never);
});

describe("sendText", () => {
  it.each(["   ", "x".repeat(2001)])("rejects invalid text %#", async (t) => {
    await expect(sendText("me", "c1", t)).rejects.toBeInstanceOf(ChatInputError);
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it("stores trimmed text, bumps lastMessageAt and marks the sender read", async () => {
    const out = await sendText("me", "c1", "  hi  ");
    expect(m(prisma.message.create).mock.calls[0][0].data).toMatchObject({
      conversationId: "c1",
      senderId: "me",
      text: "hi",
    });
    const upd = m(prisma.conversation.update).mock.calls[0][0];
    expect(upd.data).toHaveProperty("lastMessageAt");
    // "me" < "z" so me is side A.
    expect(upd.data).toHaveProperty("userALastReadAt");
    expect(upd.data).not.toHaveProperty("userBLastReadAt");
    expect(out?.text).toBe("hi");
    expect(out?.senderId).toBe("me");
  });

  it("returns null for a non-member", async () => {
    m(getConversationForUser).mockResolvedValue(null);
    expect(await sendText("me", "c1", "hi")).toBeNull();
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it("rejects when the other person is no longer active", async () => {
    m(getConversationForUser).mockResolvedValue(conv({ otherActive: false }) as never);
    await expect(sendText("me", "c1", "hi")).rejects.toThrow(
      "This person is no longer on Watchlist.",
    );
    expect(prisma.message.create).not.toHaveBeenCalled();
  });
});

describe("sendTitle", () => {
  const input = { tmdbId: 5, mediaType: "MOVIE" as const };

  it.each([
    ["empty", []],
    ["self", ["me"]],
    ["too many", Array.from({ length: 21 }, (_, i) => `u${i}`)],
  ])("rejects %s before any write", async (_n, recipientIds) => {
    await expect(sendTitle("me", { ...input, recipientIds })).rejects.toBeInstanceOf(
      ChatInputError,
    );
    expect(prisma.conversation.upsert).not.toHaveBeenCalled();
    expect(getOrCreateConversation).not.toHaveBeenCalled();
    expect(prisma.message.create).not.toHaveBeenCalled();
  });

  it("rejects an unknown or non-allowlisted recipient before any write", async () => {
    m(isActiveUser).mockImplementation(async (id: string) => id === "ok");
    await expect(
      sendTitle("me", { ...input, recipientIds: ["ok", "bad"] }),
    ).rejects.toBeInstanceOf(ChatInputError);
    expect(getOrCreateConversation).not.toHaveBeenCalled();
    expect(prisma.message.create).not.toHaveBeenCalled();
    expect(ensureCatalogTitle).not.toHaveBeenCalled();
  });

  it("rejects over-long text before any write", async () => {
    await expect(
      sendTitle("me", { ...input, recipientIds: ["a"], text: "x".repeat(2001) }),
    ).rejects.toBeInstanceOf(ChatInputError);
    expect(getOrCreateConversation).not.toHaveBeenCalled();
  });

  it("sends a card per recipient with the rating snapshot and a text 1 ms later", async () => {
    m(ensureCatalogTitle).mockResolvedValue(catalog as never);
    m(prisma.listEntry.findUnique).mockResolvedValue({ myRating: 7 } as never);
    m(getOrCreateConversation).mockImplementation((async (_u: string, o: string) => ({
      id: `conv-${o}`,
    })) as never);
    const out = await sendTitle("me", {
      ...input,
      recipientIds: ["a", "b", "a"],
      text: "you'd love this",
    });
    expect(out.conversationIds).toEqual(["conv-a", "conv-b"]);
    expect(ensureCatalogTitle).toHaveBeenCalledTimes(1);
    expect(prisma.$transaction).toHaveBeenCalledTimes(2);
    const calls = m(prisma.message.create).mock.calls.map((c) => c[0].data);
    expect(calls).toHaveLength(4);
    const [card, text] = calls;
    expect(card).toMatchObject({ conversationId: "conv-a", titleId: "t1", senderRating: 7 });
    expect(text).toMatchObject({ conversationId: "conv-a", text: "you'd love this" });
    expect((text.createdAt as Date).getTime() - (card.createdAt as Date).getTime()).toBe(1);
    expect(prisma.listEntry.create).not.toHaveBeenCalled();
    expect(prisma.listEntry.upsert).not.toHaveBeenCalled();
  });

  it("snapshots a null rating and skips blank text", async () => {
    m(ensureCatalogTitle).mockResolvedValue(catalog as never);
    m(prisma.listEntry.findUnique).mockResolvedValue(null);
    m(getOrCreateConversation).mockResolvedValue({ id: "c9" });
    await sendTitle("me", { ...input, recipientIds: ["a"], text: "   " });
    const calls = m(prisma.message.create).mock.calls.map((c) => c[0].data);
    expect(calls).toHaveLength(1);
    expect(calls[0].senderRating).toBeNull();
  });
});

describe("getMessages", () => {
  const row = (i: number) => ({
    id: `m${String(i).padStart(3, "0")}`,
    senderId: "z",
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)),
    text: "t",
    titleId: null,
    title: null,
    senderRating: null,
    reactions: [],
  });

  it("returns null for a non-member", async () => {
    m(getConversationForUser).mockResolvedValue(null);
    expect(await getMessages("me", "c1")).toBeNull();
  });

  it("fetches newest-first, returns oldest-first with hasEarlier", async () => {
    // 51 rows, newest first, as the query orders them.
    const rows = Array.from({ length: 51 }, (_, i) => row(51 - i));
    m(prisma.message.findMany).mockResolvedValue(rows as never);
    const page = await getMessages("me", "c1");
    expect(m(prisma.message.findMany).mock.calls[0][0]).toMatchObject({ take: PAGE_SIZE + 1 });
    expect(page!.messages).toHaveLength(50);
    expect(page!.hasEarlier).toBe(true);
    expect(page!.messages[0].id).toBe("m002");
    expect(page!.messages[49].id).toBe("m051");
    expect(page!.otherLastReadAt).toBeNull();
  });

  it("uses a (createdAt, id) keyset for before", async () => {
    const cursor = row(2);
    m(prisma.message.findFirst).mockResolvedValue(cursor as never);
    m(prisma.message.findMany).mockResolvedValue([row(1)] as never);
    const page = await getMessages("me", "c1", cursor.id);
    expect(page!.messages.map((x) => x.id)).toEqual(["m001"]);
    expect(page!.hasEarlier).toBe(false);
    const arg = m(prisma.message.findMany).mock.calls[0][0]!;
    expect(arg.where).toMatchObject({
      conversationId: "c1",
      OR: [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: cursor.id } },
      ],
    });
    expect(arg.orderBy).toEqual([{ createdAt: "desc" }, { id: "desc" }]);
  });

  it("maps hearts, viewer status and otherLastReadAt", async () => {
    const t = new Date("2026-01-02T00:00:00Z");
    m(getConversationForUser).mockResolvedValue(conv({ otherLastReadAt: t }) as never);
    m(prisma.message.findMany).mockResolvedValue([
      {
        ...row(1),
        titleId: "t1",
        title: catalog,
        senderRating: 8,
        reactions: [{ userId: "me" }, { userId: "z" }],
      },
    ] as never);
    m(prisma.listEntry.findMany).mockResolvedValue([
      { titleId: "t1", status: "WATCHED" },
    ] as never);
    const page = await getMessages("me", "c1");
    expect(page!.otherLastReadAt).toBe(t.toISOString());
    expect(page!.messages[0]).toMatchObject({
      senderRating: 8,
      viewerStatus: "WATCHED",
      heartedBy: ["me", "z"],
      title: { id: "t1", title: "Heat" },
    });
  });
});

describe("setHeart", () => {
  const msg = { id: "m1", conversation: { userAId: "me", userBId: "z" } };

  it("hearts with an upsert, so a repeat or concurrent heart never conflicts", async () => {
    m(prisma.message.findUnique).mockResolvedValue(msg as never);
    expect(await setHeart("me", "m1", true)).toEqual({ hearted: true });
    expect(await setHeart("me", "m1", true)).toEqual({ hearted: true });
    expect(prisma.reaction.upsert).toHaveBeenCalledTimes(2);
    expect(prisma.reaction.upsert).toHaveBeenCalledWith({
      where: { messageId_userId: { messageId: "m1", userId: "me" } },
      create: { messageId: "m1", userId: "me" },
      update: {},
    });
    expect(prisma.reaction.deleteMany).not.toHaveBeenCalled();
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  it("un-hearts with deleteMany, so a repeat un-heart is harmless", async () => {
    m(prisma.message.findUnique).mockResolvedValue(msg as never);
    m(prisma.reaction.deleteMany).mockResolvedValue({ count: 0 } as never);
    expect(await setHeart("me", "m1", false)).toEqual({ hearted: false });
    expect(prisma.reaction.deleteMany).toHaveBeenCalledWith({ where: { messageId: "m1", userId: "me" } });
    expect(prisma.reaction.upsert).not.toHaveBeenCalled();
    expect(prisma.conversation.update).not.toHaveBeenCalled();
  });

  it("returns null for someone else's conversation or a missing message", async () => {
    m(prisma.message.findUnique).mockResolvedValue({
      id: "m1",
      conversation: { userAId: "x", userBId: "y" },
    } as never);
    expect(await setHeart("me", "m1", true)).toBeNull();
    expect(await setHeart("me", "m1", false)).toBeNull();
    m(prisma.message.findUnique).mockResolvedValue(null);
    expect(await setHeart("me", "m1", true)).toBeNull();
    expect(prisma.reaction.upsert).not.toHaveBeenCalled();
    expect(prisma.reaction.deleteMany).not.toHaveBeenCalled();
  });
});
