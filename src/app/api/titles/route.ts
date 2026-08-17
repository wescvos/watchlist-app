import { NextResponse, after } from "next/server";
import { listTitles, addTitle } from "@/lib/titles";
import { tagIfUntagged } from "@/lib/mood/tagger";
import { Status } from "@prisma/client";
import type { MediaKind } from "@/lib/types";

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get("status");
  const status = raw === "WANT" || raw === "WATCHED" ? (raw as Status) : undefined;
  try {
    return NextResponse.json(await listTitles(status));
  } catch {
    return NextResponse.json({ error: "Failed to load titles" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const tmdbId = Number(body?.tmdbId);
  const mediaType = body?.mediaType as MediaKind;
  if (!tmdbId || (mediaType !== "MOVIE" && mediaType !== "TV")) {
    return NextResponse.json({ error: "tmdbId and mediaType required" }, { status: 400 });
  }
  let status: Status = Status.WANT;
  if (body?.status !== undefined) {
    if (body.status !== "WANT" && body.status !== "WATCHED") {
      return NextResponse.json({ error: "status must be WANT or WATCHED" }, { status: 400 });
    }
    status = body.status;
  }
  try {
    const title = await addTitle(tmdbId, mediaType, status);
    // Mood-tag after the response is sent, so "+ Add" never waits on Gemini.
    // after() rather than a bare unawaited promise: on Vercel the function can
    // be frozen before a detached promise settles. tagIfUntagged is a no-op for
    // an already-tagged title and never rejects.
    after(() => tagIfUntagged(title.id));
    return NextResponse.json(title);
  } catch {
    return NextResponse.json({ error: "Add failed" }, { status: 502 });
  }
}
