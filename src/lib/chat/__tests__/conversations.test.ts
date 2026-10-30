import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversation: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    message: { findMany: vi.fn() },
  },
}));

import { prisma } from "@/lib/prisma";
import {
  pairOf,
  getOrCreateConversation,
  getConversationForUser,
  listConversations,
  markRead,
  unreadCount,
} from "@/lib/chat/conversations";

const upsert = vi.mocked(prisma.conversation.upsert);
const findUnique = vi.mocked(prisma.conversation.findUnique);
const findMany = vi.mocked(prisma.conversation.findMany);
const updateMany = vi.mocked(prisma.conversation.updateMany);
const messageFindMany = vi.mocked(prisma.message.findMany);

const T0 = new Date("2026-01-01T10:00:00Z");
const T1 = new Date("2026-01-01T11:00:00Z");
const T2 = new Date("2026-01-01T12:00:00Z");

const userA = { id: "a", email: "a@x.com", name: "Ann Lee", image: null };
const userB = { id: "b", email: "b@x.com", name: "Arno Vis", image: "i.png" };

function conv(over: Record<string, unknown> = {}) {
  return {
    id: "c1",
    userAId: "a",
    userBId: "b",
    userALastReadAt: null,
    userBLastReadAt: null,
    lastMessageAt: T1,
    userA,
    userB,
    messages: [],
    ...over,
  };
}

describe("conversations", () => {
  beforeEach(() => {
    vi.stubEnv("ALLOWED_EMAILS", "a@x.com,b@x.com");
    vi.clearAllMocks();
    messageFindMany.mockResolvedValue([] as never);
  });
  afterEach(() => vi.unstubAllEnvs());

  it("pairOf sorts the ids", () => {
    expect(pairOf("b", "a")).toEqual({ userAId: "a", userBId: "b" });
    expect(pairOf("a", "b")).toEqual({ userAId: "a", userBId: "b" });
  });

  it("getOrCreateConversation upserts on the sorted pair with an empty update", async () => {
    upsert.mockResolvedValue({ id: "c1" } as never);
    expect(await getOrCreateConversation("b", "a")).toEqual({ id: "c1" });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { userAId_userBId: { userAId: "a", userBId: "b" } },
        create: { userAId: "a", userBId: "b" },
        update: {},
      }),
    );
  });

  it("getConversationForUser returns null for a non-member", async () => {
    findUnique.mockResolvedValue(conv() as never);
    expect(await getConversationForUser("c", "c1")).toBeNull();
  });

  it("getConversationForUser returns null for an unknown conversation", async () => {
    findUnique.mockResolvedValue(null);
    expect(await getConversationForUser("a", "nope")).toBeNull();
  });

  it("getConversationForUser resolves the other person and read times", async () => {
    findUnique.mockResolvedValue(
      conv({ userALastReadAt: T0, userBLastReadAt: T1 }) as never,
    );
    const r = await getConversationForUser("a", "c1");
    expect(r).toEqual({
      id: "c1",
      other: { id: "b", firstName: "Arno", image: "i.png" },
      otherActive: true,
      myLastReadAt: T0,
      otherLastReadAt: T1,
    });
    expect(JSON.stringify(r)).not.toContain("@");
  });

  it("getConversationForUser flags an inactive other person", async () => {
    vi.stubEnv("ALLOWED_EMAILS", "a@x.com");
    findUnique.mockResolvedValue(conv() as never);
    expect((await getConversationForUser("a", "c1"))?.otherActive).toBe(false);
  });

  describe("unreadCount", () => {
    it("is not unread when the latest message is mine", async () => {
      findMany.mockResolvedValue([conv()] as never);
      messageFindMany.mockResolvedValue([] as never);
      expect(await unreadCount("a")).toBe(0);
    });

    it("is unread when their message is after my lastReadAt", async () => {
      findMany.mockResolvedValue([conv({ userALastReadAt: T0 })] as never);
      messageFindMany.mockResolvedValue([
        { conversationId: "c1", createdAt: T1 },
      ] as never);
      expect(await unreadCount("a")).toBe(1);
    });

    it("is unread when lastReadAt is null and they sent something", async () => {
      findMany.mockResolvedValue([conv()] as never);
      messageFindMany.mockResolvedValue([
        { conversationId: "c1", createdAt: T1 },
      ] as never);
      expect(await unreadCount("a")).toBe(1);
    });

    it("is read when I read after their message", async () => {
      findMany.mockResolvedValue([conv({ userALastReadAt: T2 })] as never);
      messageFindMany.mockResolvedValue([
        { conversationId: "c1", createdAt: T1 },
      ] as never);
      expect(await unreadCount("a")).toBe(0);
    });
  });

  describe("listConversations", () => {
    const card = (senderId: string) => ({
      senderId,
      createdAt: T1,
      text: null,
      title: { title: "Dune: Part Two" },
    });

    it("previews my card as 'You sent'", async () => {
      findMany.mockResolvedValue([conv({ messages: [card("a")] })] as never);
      const [s] = await listConversations("a");
      expect(s.preview).toBe("You sent Dune: Part Two");
      expect(s.unread).toBe(false);
    });

    it("previews their card with their first name and marks it unread", async () => {
      findMany.mockResolvedValue([conv({ messages: [card("b")] })] as never);
      messageFindMany.mockResolvedValue([
        { conversationId: "c1", createdAt: T1 },
      ] as never);
      const [s] = await listConversations("a");
      expect(s.preview).toBe("Arno sent Dune: Part Two");
      expect(s.unread).toBe(true);
      expect(s.lastMessageAt).toBe(T1.toISOString());
      expect(s.other.firstName).toBe("Arno");
    });

    it("previews a text message as its text", async () => {
      findMany.mockResolvedValue([
        conv({ messages: [{ senderId: "b", createdAt: T1, text: "hi", title: null }] }),
      ] as never);
      expect((await listConversations("a"))[0].preview).toBe("hi");
    });

    it("omits conversations without messages and sorts newest first", async () => {
      findMany.mockResolvedValue([
        conv({ id: "old", lastMessageAt: T0, messages: [card("a")] }),
        conv({ id: "empty", messages: [] }),
        conv({ id: "new", lastMessageAt: T2, messages: [card("a")] }),
      ] as never);
      expect((await listConversations("a")).map((s) => s.id)).toEqual(["new", "old"]);
    });
  });

  describe("markRead", () => {
    it("returns false and writes nothing for a non-member", async () => {
      findUnique.mockResolvedValue(conv() as never);
      expect(await markRead("c", "c1")).toBe(false);
      expect(updateMany).not.toHaveBeenCalled();
    });

    it("sets my side's lastReadAt", async () => {
      findUnique.mockResolvedValue(conv() as never);
      updateMany.mockResolvedValue({ count: 1 } as never);
      expect(await markRead("b", "c1")).toBe(true);
      expect(updateMany).toHaveBeenCalledWith({
        where: { id: "c1" },
        data: { userBLastReadAt: expect.any(Date) },
      });
    });
  });
});
