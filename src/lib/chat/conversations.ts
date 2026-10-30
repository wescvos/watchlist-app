import { prisma } from "@/lib/prisma";
import { isAllowedEmail } from "@/lib/allowlist";
import { firstNameOf, type Person } from "@/lib/chat/people";

export type ConversationSummary = {
  id: string;
  other: Person;
  otherActive: boolean;
  lastMessageAt: string;
  preview: string;
  unread: boolean;
};

type UserRow = { id: string; email: string; name: string | null; image: string | null };

const userSelect = { id: true, email: true, name: true, image: true } as const;

// One conversation per pair, keyed by the lexicographically smaller id first,
// so both people always resolve to the same row.
export function pairOf(a: string, b: string): { userAId: string; userBId: string } {
  return a < b ? { userAId: a, userBId: b } : { userAId: b, userBId: a };
}

export async function getOrCreateConversation(
  userId: string,
  otherId: string,
): Promise<{ id: string }> {
  const pair = pairOf(userId, otherId);
  // update: {} makes a concurrent double-create harmless: the loser just reads.
  return prisma.conversation.upsert({
    where: { userAId_userBId: pair },
    create: pair,
    update: {},
    select: { id: true },
  });
}

type ConvRow = {
  id: string;
  userAId: string;
  userALastReadAt: Date | null;
  userBLastReadAt: Date | null;
  userA: UserRow;
  userB: UserRow;
};

// Resolves which side of the pair the caller is, or null when they are not a
// member. Callers map null to 404 so a conversation's existence never leaks.
function viewFor(userId: string, c: ConvRow) {
  const isA = c.userAId === userId;
  const isB = !isA && c.userB.id === userId;
  if (!isA && !isB) return null;
  const other = isA ? c.userB : c.userA;
  return {
    isA,
    other: { id: other.id, firstName: firstNameOf(other), image: other.image },
    otherActive: isAllowedEmail(other.email),
    myLastReadAt: isA ? c.userALastReadAt : c.userBLastReadAt,
    otherLastReadAt: isA ? c.userBLastReadAt : c.userALastReadAt,
  };
}

export async function getConversationForUser(userId: string, conversationId: string) {
  const c = await prisma.conversation.findUnique({
    where: { id: conversationId },
    include: { userA: { select: userSelect }, userB: { select: userSelect } },
  });
  if (!c) return null;
  const v = viewFor(userId, c);
  if (!v) return null;
  return {
    id: c.id,
    other: v.other,
    otherActive: v.otherActive,
    myLastReadAt: v.myLastReadAt,
    otherLastReadAt: v.otherLastReadAt,
  };
}

const memberWhere = (userId: string) => ({
  OR: [{ userAId: userId }, { userBId: userId }],
});

// Latest message from the other person in one conversation. Unread is defined
// by their messages only, so my own sends never make a chat unread for me. One
// bounded lookup per conversation (there are only a handful of users), so
// unread never scans a chat's history.
async function latestFromOther(userId: string, conversationId: string) {
  const m = await prisma.message.findFirst({
    where: { conversationId, senderId: { not: userId } },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return m?.createdAt;
}

// A message exactly at my lastReadAt counts as read.
function isUnread(theirLatest: Date | undefined, myLastReadAt: Date | null) {
  if (!theirLatest) return false;
  return !myLastReadAt || theirLatest > myLastReadAt;
}

export async function listConversations(userId: string): Promise<ConversationSummary[]> {
  const convs = await prisma.conversation.findMany({
    where: memberWhere(userId),
    include: { userA: { select: userSelect }, userB: { select: userSelect } },
    orderBy: { lastMessageAt: "desc" },
  });
  const rows = await Promise.all(
    convs.map(async (c) => {
      const [last, theirLatest] = await Promise.all([
        // Latest message only, for the preview; reactions live in another
        // table and never count.
        prisma.message.findFirst({
          where: { conversationId: c.id },
          orderBy: { createdAt: "desc" },
          select: { senderId: true, text: true, title: { select: { title: true } } },
        }),
        latestFromOther(userId, c.id),
      ]);
      return { c, last, theirLatest };
    }),
  );

  return rows
    .flatMap(({ c, last, theirLatest }) => {
      if (!last) return [];
      const v = viewFor(userId, c)!;
      const mine = last.senderId === userId;
      const preview = last.title
        ? `${mine ? "You" : v.other.firstName} sent ${last.title.title}`
        : (last.text ?? "");
      return [
        {
          id: c.id,
          other: v.other,
          otherActive: v.otherActive,
          lastMessageAt: c.lastMessageAt.toISOString(),
          preview,
          unread: isUnread(theirLatest, v.myLastReadAt),
        },
      ];
    })
    .sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
}

export async function markRead(userId: string, conversationId: string): Promise<boolean> {
  const c = await prisma.conversation.findUnique({
    where: { id: conversationId },
    select: { userAId: true, userBId: true },
  });
  if (!c || (c.userAId !== userId && c.userBId !== userId)) return false;
  await prisma.conversation.updateMany({
    where: { id: conversationId },
    data: c.userAId === userId ? { userALastReadAt: new Date() } : { userBLastReadAt: new Date() },
  });
  return true;
}

export async function unreadCount(userId: string): Promise<number> {
  const convs = await prisma.conversation.findMany({
    where: memberWhere(userId),
    select: { id: true, userAId: true, userALastReadAt: true, userBLastReadAt: true },
  });
  const unread = await Promise.all(
    convs.map(async (c) =>
      isUnread(
        await latestFromOther(userId, c.id),
        c.userAId === userId ? c.userALastReadAt : c.userBLastReadAt,
      ),
    ),
  );
  return unread.filter(Boolean).length;
}
