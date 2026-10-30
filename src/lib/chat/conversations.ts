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

// Latest message from the other person per conversation. Unread is defined by
// their messages only, so my own sends never make a chat unread for me.
async function latestFromOthers(userId: string, ids: string[]) {
  const rows = await prisma.message.findMany({
    where: { conversationId: { in: ids }, senderId: { not: userId } },
    orderBy: { createdAt: "desc" },
    distinct: ["conversationId"],
    select: { conversationId: true, createdAt: true },
  });
  return new Map(rows.map((r) => [r.conversationId, r.createdAt]));
}

function isUnread(theirLatest: Date | undefined, myLastReadAt: Date | null) {
  if (!theirLatest) return false;
  return !myLastReadAt || theirLatest > myLastReadAt;
}

export async function listConversations(userId: string): Promise<ConversationSummary[]> {
  const convs = await prisma.conversation.findMany({
    where: memberWhere(userId),
    include: {
      userA: { select: userSelect },
      userB: { select: userSelect },
      // Latest message only; reactions live in another table and never count.
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { senderId: true, createdAt: true, text: true, title: { select: { title: true } } },
      },
    },
    orderBy: { lastMessageAt: "desc" },
  });
  const withMessages = convs.filter((c) => c.messages.length > 0);
  if (withMessages.length === 0) return [];
  const theirs = await latestFromOthers(
    userId,
    withMessages.map((c) => c.id),
  );

  return withMessages
    .map((c) => {
      const v = viewFor(userId, c)!;
      const last = c.messages[0];
      const mine = last.senderId === userId;
      const preview = last.title
        ? `${mine ? "You" : v.other.firstName} sent ${last.title.title}`
        : (last.text ?? "");
      return {
        id: c.id,
        other: v.other,
        otherActive: v.otherActive,
        lastMessageAt: c.lastMessageAt.toISOString(),
        preview,
        unread: isUnread(theirs.get(c.id), v.myLastReadAt),
      };
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
  if (convs.length === 0) return 0;
  const theirs = await latestFromOthers(
    userId,
    convs.map((c) => c.id),
  );
  return convs.filter((c) =>
    isUnread(theirs.get(c.id), c.userAId === userId ? c.userALastReadAt : c.userBLastReadAt),
  ).length;
}
