import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: {
    conversation: {
      upsert: vi.fn(),
      findUnique: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    message: { findFirst: vi.fn() },
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
const messageFindFirst = vi.mocked(prisma.message.findFirst);

type Msg = { conversationId: string; senderId: string; createdAt: Date; text?: string | null; title?: { title: string } | null };

// Answers findFirst like the database would: filter by conversation and an
// optional senderId { not }, newest first.
function messages(rows: Msg[]) {
  messageFindFirst.mockImplementation((async (args: {
    where: { conversationId: string; senderId?: { not: string } };
  }) => {
    const { conversationId, senderId } = args.where;
    const hit = rows
      .filter((r) => r.conversationId === conversationId && (!senderId || r.senderId !== senderId.not))
      .sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime())[0];
    return hit ? { text: null, title: null, ...hit } : null;
  }) as never);
}

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
    ...over,
  };
}

describe("conversations", () => {
  beforeEach(() => {
    vi.stubEnv("ALLOWED_EMAILS", "a@x.com,b@x.com");
    vi.clearAllMocks();
    messages([]);
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
      messages([{ conversationId: "c1", senderId: "a", createdAt: T1 }]);
      expect(await unreadCount("a")).toBe(0);
    });

    it("is unread when their message is after my lastReadAt", async () => {
      findMany.mockResolvedValue([conv({ userALastReadAt: T0 })] as never);
      messages([{ conversationId: "c1", senderId: "b", createdAt: T1 }]);
      expect(await unreadCount("a")).toBe(1);
    });

    it("is unread when lastReadAt is null and they sent something", async () => {
      findMany.mockResolvedValue([conv()] as never);
      messages([{ conversationId: "c1", senderId: "b", createdAt: T1 }]);
      expect(await unreadCount("a")).toBe(1);
    });

    it("is read when I read after their message", async () => {
      findMany.mockResolvedValue([conv({ userALastReadAt: T2 })] as never);
      messages([{ conversationId: "c1", senderId: "b", createdAt: T1 }]);
      expect(await unreadCount("a")).toBe(0);
    });

    it("is read when their message is exactly at my lastReadAt", async () => {
      findMany.mockResolvedValue([conv({ userALastReadAt: T1 })] as never);
      messages([{ conversationId: "c1", senderId: "b", createdAt: T1 }]);
      expect(await unreadCount("a")).toBe(0);
    });

    it("queries only my conversations and one bounded latest-from-them per chat", async () => {
      findMany.mockResolvedValue([conv(), conv({ id: "c2" })] as never);
      messages([]);
      await unreadCount("a");
      expect(findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { OR: [{ userAId: "a" }, { userBId: "a" }] } }),
      );
      expect(messageFindFirst).toHaveBeenCalledTimes(2);
      for (const id of ["c1", "c2"]) {
        expect(messageFindFirst).toHaveBeenCalledWith({
          where: { conversationId: id, senderId: { not: "a" } },
          orderBy: { createdAt: "desc" },
          select: { createdAt: true },
        });
      }
    });
  });

  describe("listConversations", () => {
    const card = (senderId: string, conversationId = "c1", createdAt = T1): Msg => ({
      conversationId,
      senderId,
      createdAt,
      text: null,
      title: { title: "Dune: Part Two" },
    });

    it("previews my card as 'You sent'", async () => {
      findMany.mockResolvedValue([conv()] as never);
      messages([card("a")]);
      const [s] = await listConversations("a");
      expect(s.preview).toBe("You sent Dune: Part Two");
      expect(s.unread).toBe(false);
    });

    it("previews their card with their first name and marks it unread", async () => {
      findMany.mockResolvedValue([conv()] as never);
      messages([card("b")]);
      const [s] = await listConversations("a");
      expect(s.preview).toBe("Arno sent Dune: Part Two");
      expect(s.unread).toBe(true);
      expect(s.lastMessageAt).toBe(T1.toISOString());
      expect(s.other.firstName).toBe("Arno");
    });

    it("stays unread when my reply is newest but their earlier message is unread", async () => {
      findMany.mockResolvedValue([conv({ userALastReadAt: T0 })] as never);
      messages([card("b", "c1", T1), card("a", "c1", T2)]);
      const [s] = await listConversations("a");
      expect(s.preview).toBe("You sent Dune: Part Two");
      expect(s.unread).toBe(true);
    });

    it("previews a text message as its text", async () => {
      findMany.mockResolvedValue([conv()] as never);
      messages([{ conversationId: "c1", senderId: "b", createdAt: T1, text: "hi", title: null }]);
      expect((await listConversations("a"))[0].preview).toBe("hi");
    });

    it("omits conversations without messages and sorts newest first", async () => {
      findMany.mockResolvedValue([
        conv({ id: "old", lastMessageAt: T0 }),
        conv({ id: "empty" }),
        conv({ id: "new", lastMessageAt: T2 }),
      ] as never);
      messages([card("a", "old"), card("a", "new")]);
      expect((await listConversations("a")).map((s) => s.id)).toEqual(["new", "old"]);
    });

    it("scopes to my conversations and bounds every message lookup", async () => {
      findMany.mockResolvedValue([conv()] as never);
      messages([card("b")]);
      await listConversations("a");
      const convArgs = findMany.mock.calls[0][0] as { where: unknown; include: Record<string, unknown> };
      expect(convArgs.where).toEqual({ OR: [{ userAId: "a" }, { userBId: "a" }] });
      expect(convArgs.include).not.toHaveProperty("messages");
      const calls = messageFindFirst.mock.calls.map((c) => c[0] as { where: Record<string, unknown> });
      expect(calls).toHaveLength(2);
      expect(calls.map((c) => c.where)).toEqual(
        expect.arrayContaining([
          { conversationId: "c1" },
          { conversationId: "c1", senderId: { not: "a" } },
        ]),
      );
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
