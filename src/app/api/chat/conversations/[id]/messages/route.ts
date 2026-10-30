import { NextResponse } from "next/server";
import { getMessages, sendText } from "@/lib/chat/messages";
import { badRequest, notFound, readObject, withUser } from "@/lib/chat/route";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, { params }: Ctx) {
  return withUser(async (userId) => {
    const { id } = await params;
    const before = new URL(req.url).searchParams.get("before") ?? undefined;
    const page = await getMessages(userId, id, before);
    return page ? NextResponse.json(page) : notFound();
  });
}

export async function POST(req: Request, { params }: Ctx) {
  return withUser(async (userId) => {
    const { id } = await params;
    const body = await readObject(req);
    if (!body || typeof body.text !== "string") return badRequest("text must be a string");
    const message = await sendText(userId, id, body.text);
    return message ? NextResponse.json(message) : notFound();
  });
}
