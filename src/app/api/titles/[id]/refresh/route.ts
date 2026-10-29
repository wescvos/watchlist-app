import { NextResponse, after } from "next/server";
import { refreshTitle, getTitle } from "@/lib/titles";
import { getCurrentUserId } from "@/lib/currentUser";
import { tagIfUntagged } from "@/lib/mood/tagger";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    // The catalog is shared, so only refresh titles on this user's list.
    if (!(await getTitle(userId, id))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    await refreshTitle(id);
    // Tag on refresh too, so a title that predates mood tagging picks moods up
    // without a special path. Gated on moodsTaggedAt inside tagIfUntagged, so a
    // refresh of an already-tagged title costs nothing.
    after(() => tagIfUntagged(id));
    const listed = await getTitle(userId, id);
    if (!listed) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(listed);
  } catch {
    return NextResponse.json({ error: "Refresh failed" }, { status: 502 });
  }
}
