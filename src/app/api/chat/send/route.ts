import { NextResponse } from "next/server";
import { sendTitle } from "@/lib/chat/messages";
import { badRequest, readObject, withUser } from "@/lib/chat/route";

export async function POST(req: Request) {
  return withUser(async (userId) => {
    const body = await readObject(req);
    if (!body) return badRequest("Invalid body");
    const { recipientIds, tmdbId, mediaType, text } = body;
    if (!Array.isArray(recipientIds) || !recipientIds.every((r) => typeof r === "string")) {
      return badRequest("recipientIds must be an array of strings");
    }
    if (typeof tmdbId !== "number" || !Number.isInteger(tmdbId) || tmdbId <= 0) {
      return badRequest("tmdbId must be a positive integer");
    }
    if (mediaType !== "MOVIE" && mediaType !== "TV") return badRequest("mediaType must be MOVIE or TV");
    if (text !== undefined && typeof text !== "string") return badRequest("text must be a string");
    const result = await sendTitle(userId, { recipientIds, tmdbId, mediaType, text });
    return NextResponse.json(result);
  });
}
