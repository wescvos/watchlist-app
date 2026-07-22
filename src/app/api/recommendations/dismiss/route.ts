import { NextResponse } from "next/server";
import { dismissTitle } from "@/lib/recommendations";
import type { MediaKind } from "@/lib/types";

// Records a permanent "not interested" dismissal so the title stops being
// recommended. Idempotent (upsert); never deletes anything from the lists.
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const tmdbId = Number(body?.tmdbId);
  const mediaType = body?.mediaType as MediaKind;
  if (!Number.isInteger(tmdbId) || (mediaType !== "MOVIE" && mediaType !== "TV")) {
    return NextResponse.json({ error: "tmdbId and mediaType required" }, { status: 400 });
  }
  try {
    await dismissTitle(tmdbId, mediaType);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Couldn't dismiss." }, { status: 500 });
  }
}
