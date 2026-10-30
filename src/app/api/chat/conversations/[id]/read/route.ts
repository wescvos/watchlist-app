import { NextResponse } from "next/server";
import { markRead } from "@/lib/chat/conversations";
import { notFound, withUser } from "@/lib/chat/route";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (userId) => {
    const { id } = await params;
    return (await markRead(userId, id)) ? NextResponse.json({ ok: true }) : notFound();
  });
}
