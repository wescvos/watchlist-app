import { NextResponse } from "next/server";
import { setHeart } from "@/lib/chat/messages";
import { badRequest, notFound, readObject, withUser } from "@/lib/chat/route";

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  return withUser(async (userId) => {
    const { id } = await params;
    const body = await readObject(req);
    if (!body || typeof body.hearted !== "boolean") return badRequest("hearted must be a boolean");
    const result = await setHeart(userId, id, body.hearted);
    return result ? NextResponse.json(result) : notFound();
  });
}
