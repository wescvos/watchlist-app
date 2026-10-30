import { requireUserId } from "@/lib/currentUser";
import { ChatsList } from "./ChatsList";

export const dynamic = "force-dynamic";

export default async function ChatsPage() {
  await requireUserId();
  return <ChatsList />;
}
