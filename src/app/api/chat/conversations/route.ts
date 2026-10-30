import { NextResponse } from "next/server";
import { getOrCreateConversation, listConversations } from "@/lib/chat/conversations";
import { isActiveUser } from "@/lib/chat/people";
import { badRequest, readObject, withUser } from "@/lib/chat/route";

export async function GET() {
  return withUser(async (userId) => NextResponse.json(await listConversations(userId)));
}

export async function POST(req: Request) {
  return withUser(async (userId) => {
    const body = await readObject(req);
    if (!body || typeof body.otherUserId !== "string" || !body.otherUserId) {
      return badRequest("otherUserId must be a string");
    }
    const otherId = body.otherUserId;
    if (otherId === userId) return badRequest("You can't start a chat with yourself.");
    if (!(await isActiveUser(otherId))) return badRequest("This person is not on Watchlist.");
    const { id } = await getOrCreateConversation(userId, otherId);
    return NextResponse.json({ id });
  });
}
