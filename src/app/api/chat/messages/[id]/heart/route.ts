import { NextResponse } from "next/server";
import { toggleHeart } from "@/lib/chat/messages";
import { notFound, withUser } from "@/lib/chat/route";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (userId) => {
    const { id } = await params;
    const result = await toggleHeart(userId, id);
    return result ? NextResponse.json(result) : notFound();
  });
}
