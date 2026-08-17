import { NextResponse, after } from "next/server";
import { refreshTitle } from "@/lib/titles";
import { tagIfUntagged } from "@/lib/mood/tagger";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    const title = await refreshTitle(id);
    // Tag on refresh too, so a title that predates mood tagging picks moods up
    // without a special path. Gated on moodsTaggedAt inside tagIfUntagged, so a
    // refresh of an already-tagged title costs nothing.
    after(() => tagIfUntagged(id));
    return NextResponse.json(title);
  } catch {
    return NextResponse.json({ error: "Refresh failed" }, { status: 502 });
  }
}
