import { NextResponse } from "next/server";
import { unreadCount } from "@/lib/chat/conversations";
import { withUser } from "@/lib/chat/route";

export async function GET() {
  return withUser(async (userId) => NextResponse.json({ count: await unreadCount(userId) }));
}
