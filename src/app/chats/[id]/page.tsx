import { notFound } from "next/navigation";
import { requireUserId } from "@/lib/currentUser";
import { getConversationForUser } from "@/lib/chat/conversations";
import { getMessages } from "@/lib/chat/messages";
import { ChatThread } from "./ChatThread";

export const dynamic = "force-dynamic";

export default async function ChatThreadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const userId = await requireUserId();
  // Not a member (or no such chat) is a 404, never a 403.
  const conv = await getConversationForUser(userId, id);
  if (!conv) notFound();
  const page = await getMessages(userId, id);
  if (!page) notFound();

  return (
    <ChatThread
      conversationId={conv.id}
      meId={userId}
      other={conv.other}
      otherActive={conv.otherActive}
      initialPage={page}
    />
  );
}
