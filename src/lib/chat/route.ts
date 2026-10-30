import { NextResponse } from "next/server";
import { getCurrentUserId } from "@/lib/currentUser";
import { ChatInputError } from "@/lib/chat/messages";

export const unauthorized = () => NextResponse.json({ error: "Unauthorized" }, { status: 401 });
export const notFound = () => NextResponse.json({ error: "Not found" }, { status: 404 });
export const badRequest = (error: string) => NextResponse.json({ error }, { status: 400 });

// Shared gate for chat routes: 401 before any data call, ChatInputError to 400
// with its message, anything else logged and returned as 500.
export async function withUser(fn: (userId: string) => Promise<Response>): Promise<Response> {
  const userId = await getCurrentUserId();
  if (!userId) return unauthorized();
  try {
    return await fn(userId);
  } catch (e) {
    if (e instanceof ChatInputError) return badRequest(e.message);
    console.error("chat route failed", e);
    return NextResponse.json({ error: "Something went wrong" }, { status: 500 });
  }
}

// Parses a JSON object body, or null when it is malformed or not an object.
export async function readObject(req: Request): Promise<Record<string, unknown> | null> {
  const body = await req.json().catch(() => null);
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}
