import { prisma } from "@/lib/prisma";
import { isActiveUser } from "@/lib/chat/people";
import { getConversationForUser, getOrCreateConversation, pairOf } from "@/lib/chat/conversations";
import { ensureCatalogTitle } from "@/lib/titles";
import type { MediaKind } from "@/lib/types";
import type { MediaType } from "@prisma/client";

export const MAX_MESSAGE_LENGTH = 2000;
export const PAGE_SIZE = 50;
const MAX_RECIPIENTS = 20;

// Routes map this to a 400 and show its message, so keep the wording user-readable.
export class ChatInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ChatInputError";
  }
}

export type ChatTitle = {
  id: string;
  tmdbId: number;
  mediaType: MediaType;
  title: string;
  year: number | null;
  posterUrl: string | null;
};

export type ChatMessage = {
  id: string;
  senderId: string;
  createdAt: string;
  text: string | null;
  title: ChatTitle | null;
  senderRating: number | null;
  viewerStatus: "WANT" | "WATCHED" | null;
  heartedBy: string[];
};

export type ChatPage = {
  messages: ChatMessage[];
  hasEarlier: boolean;
  otherLastReadAt: string | null;
};

const messageInclude = {
  title: {
    select: { id: true, tmdbId: true, mediaType: true, title: true, year: true, posterUrl: true },
  },
  reactions: { select: { userId: true } },
} as const;

type MessageRow = {
  id: string;
  senderId: string;
  createdAt: Date;
  text: string | null;
  titleId: string | null;
  senderRating: number | null;
  title: ChatTitle | null;
  reactions: { userId: string }[];
};

// Trim and bound plain text. Shared so chat text and the optional note on a
// sent movie obey one rule.
function cleanText(raw: string): string | null {
  const text = raw.trim();
  if (!text) return null;
  if (text.length > MAX_MESSAGE_LENGTH) {
    throw new ChatInputError(`Messages can be at most ${MAX_MESSAGE_LENGTH} characters.`);
  }
  return text;
}

function toChatMessage(r: MessageRow, statuses: Map<string, "WANT" | "WATCHED">): ChatMessage {
  return {
    id: r.id,
    senderId: r.senderId,
    createdAt: r.createdAt.toISOString(),
    text: r.text,
    title: r.title
      ? {
          id: r.title.id,
          tmdbId: r.title.tmdbId,
          mediaType: r.title.mediaType,
          title: r.title.title,
          year: r.title.year,
          posterUrl: r.title.posterUrl,
        }
      : null,
    senderRating: r.senderRating,
    viewerStatus: r.titleId ? (statuses.get(r.titleId) ?? null) : null,
    heartedBy: r.reactions.map((x) => x.userId),
  };
}

// The viewer's own list status per title, so a card can offer "add" only when
// the viewer does not already have it.
async function statusesFor(userId: string, rows: MessageRow[]) {
  const titleIds = [...new Set(rows.flatMap((r) => (r.titleId ? [r.titleId] : [])))];
  if (titleIds.length === 0) return new Map<string, "WANT" | "WATCHED">();
  const entries = await prisma.listEntry.findMany({
    where: { userId, titleId: { in: titleIds } },
    select: { titleId: true, status: true },
  });
  return new Map(entries.map((e) => [e.titleId, e.status as "WANT" | "WATCHED"]));
}

// Sending bumps lastMessageAt and marks the sender's own side read in the same
// write, so their own message never shows as unread to them. The other side's
// lastReadAt is never touched.
function senderSideUpdate(userId: string, otherId: string, at: Date) {
  const senderIsA = pairOf(userId, otherId).userAId === userId;
  return senderIsA
    ? { lastMessageAt: at, userALastReadAt: at }
    : { lastMessageAt: at, userBLastReadAt: at };
}

export async function getMessages(
  userId: string,
  conversationId: string,
  before?: string,
): Promise<ChatPage | null> {
  const conv = await getConversationForUser(userId, conversationId);
  if (!conv) return null;
  const otherLastReadAt = conv.otherLastReadAt ? conv.otherLastReadAt.toISOString() : null;

  let cursorWhere = {};
  if (before) {
    const cursor = await prisma.message.findFirst({
      where: { id: before, conversationId },
      select: { id: true, createdAt: true },
    });
    // Unknown cursor: nothing earlier to show rather than an error.
    if (!cursor) return { messages: [], hasEarlier: false, otherLastReadAt };
    // Keyset on (createdAt, id) so messages sharing a timestamp are neither
    // repeated nor skipped across pages.
    cursorWhere = {
      OR: [
        { createdAt: { lt: cursor.createdAt } },
        { createdAt: cursor.createdAt, id: { lt: cursor.id } },
      ],
    };
  }

  const rows = (await prisma.message.findMany({
    where: { conversationId, ...cursorWhere },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: PAGE_SIZE + 1,
    include: messageInclude,
  })) as MessageRow[];
  const hasEarlier = rows.length > PAGE_SIZE;
  const pageRows = rows.slice(0, PAGE_SIZE).reverse();
  const statuses = await statusesFor(userId, pageRows);
  return {
    messages: pageRows.map((r) => toChatMessage(r, statuses)),
    hasEarlier,
    otherLastReadAt,
  };
}

export async function sendText(
  userId: string,
  conversationId: string,
  rawText: string,
): Promise<ChatMessage | null> {
  const conv = await getConversationForUser(userId, conversationId);
  if (!conv) return null;
  const text = cleanText(rawText);
  if (!text) throw new ChatInputError("Write a message first.");
  if (!conv.otherActive) throw new ChatInputError("This person is no longer on Watchlist.");

  const now = new Date();
  const [created] = await prisma.$transaction([
    prisma.message.create({
      data: { conversationId, senderId: userId, text, createdAt: now },
      include: messageInclude,
    }),
    prisma.conversation.update({
      where: { id: conversationId },
      data: senderSideUpdate(userId, conv.other.id, now),
    }),
  ]);
  return toChatMessage(created as MessageRow, new Map());
}

export async function sendTitle(
  userId: string,
  input: { recipientIds: string[]; tmdbId: number; mediaType: MediaKind; text?: string },
): Promise<{ conversationIds: string[] }> {
  // All validation happens before the first write, so a bad request never
  // leaves a half-sent batch behind.
  const recipientIds = [...new Set(input.recipientIds)];
  if (recipientIds.length === 0) throw new ChatInputError("Pick at least one person.");
  if (recipientIds.length > MAX_RECIPIENTS) {
    throw new ChatInputError(`You can send to at most ${MAX_RECIPIENTS} people.`);
  }
  if (recipientIds.includes(userId)) throw new ChatInputError("You cannot send a movie to yourself.");
  const text = cleanText(input.text ?? "");
  const active = await Promise.all(recipientIds.map((id) => isActiveUser(id)));
  if (active.some((ok) => !ok)) {
    throw new ChatInputError("Someone you picked is no longer on Watchlist.");
  }

  const title = await ensureCatalogTitle(input.tmdbId, input.mediaType);
  // Snapshot of the sender's rating now; later re-rating must not rewrite history.
  const entry = await prisma.listEntry.findUnique({
    where: { userId_titleId: { userId, titleId: title.id } },
    select: { myRating: true },
  });
  const senderRating = entry?.myRating ?? null;

  const conversationIds: string[] = [];
  for (const recipientId of recipientIds) {
    const { id: conversationId } = await getOrCreateConversation(userId, recipientId);
    const cardAt = new Date();
    // The note sits 1 ms after the card so the two always order card-first.
    const textAt = new Date(cardAt.getTime() + 1);
    const lastAt = text ? textAt : cardAt;
    await prisma.$transaction([
      prisma.message.create({
        data: { conversationId, senderId: userId, titleId: title.id, senderRating, createdAt: cardAt },
      }),
      ...(text
        ? [
            prisma.message.create({
              data: { conversationId, senderId: userId, text, createdAt: textAt },
            }),
          ]
        : []),
      prisma.conversation.update({
        where: { id: conversationId },
        data: senderSideUpdate(userId, recipientId, lastAt),
      }),
    ]);
    conversationIds.push(conversationId);
  }
  return { conversationIds };
}

export async function toggleHeart(
  userId: string,
  messageId: string,
): Promise<{ hearted: boolean } | null> {
  const message = await prisma.message.findUnique({
    where: { id: messageId },
    select: { id: true, conversation: { select: { userAId: true, userBId: true } } },
  });
  const c = message?.conversation;
  if (!message || !c || (c.userAId !== userId && c.userBId !== userId)) return null;

  const key = { messageId_userId: { messageId, userId } };
  const existing = await prisma.reaction.findUnique({ where: key, select: { id: true } });
  if (existing) {
    // deleteMany tolerates a concurrent un-heart from a second tap.
    await prisma.reaction.deleteMany({ where: { messageId, userId } });
    return { hearted: false };
  }
  // Hearts are quiet: deliberately no lastMessageAt or read-state change.
  await prisma.reaction.create({ data: { messageId, userId } });
  return { hearted: true };
}
