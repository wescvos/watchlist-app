import { NextResponse } from "next/server";
import { searchTitles } from "@/lib/tmdb";
import { getCurrentUserId } from "@/lib/currentUser";
import { prisma } from "@/lib/prisma";
import type { SearchResultWithLibrary } from "@/lib/types";

export async function GET(req: Request) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ error: "Missing q" }, { status: 400 });
  try {
    const results = await searchTitles(q);
    if (results.length === 0) return NextResponse.json([]);

    // Only this user's entries count as "in your library".
    const existing = await prisma.listEntry.findMany({
      where: {
        userId,
        title: { OR: results.map((r) => ({ tmdbId: r.tmdbId, mediaType: r.mediaType })) },
      },
      select: { status: true, title: { select: { id: true, tmdbId: true, mediaType: true } } },
    });
    const byKey = new Map(existing.map((e) => [`${e.title.mediaType}-${e.title.tmdbId}`, e]));

    const withLibrary: SearchResultWithLibrary[] = results.map((r) => {
      const match = byKey.get(`${r.mediaType}-${r.tmdbId}`);
      return { ...r, library: match ? { id: match.title.id, status: match.status } : null };
    });
    return NextResponse.json(withLibrary);
  } catch (e) {
    console.error("Search failed:", e);
    return NextResponse.json({ error: "Search failed" }, { status: 502 });
  }
}
