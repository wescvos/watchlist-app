import { NextResponse } from "next/server";
import { searchTitles } from "@/lib/tmdb";
import { prisma } from "@/lib/prisma";
import type { SearchResultWithLibrary } from "@/lib/types";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ error: "Missing q" }, { status: 400 });
  try {
    const results = await searchTitles(q);
    if (results.length === 0) return NextResponse.json([]);

    const existing = await prisma.title.findMany({
      where: { OR: results.map((r) => ({ tmdbId: r.tmdbId, mediaType: r.mediaType })) },
      select: { id: true, tmdbId: true, mediaType: true, status: true },
    });
    const byKey = new Map(existing.map((t) => [`${t.mediaType}-${t.tmdbId}`, t]));

    const withLibrary: SearchResultWithLibrary[] = results.map((r) => {
      const match = byKey.get(`${r.mediaType}-${r.tmdbId}`);
      return { ...r, library: match ? { id: match.id, status: match.status } : null };
    });
    return NextResponse.json(withLibrary);
  } catch {
    return NextResponse.json({ error: "Search failed" }, { status: 502 });
  }
}
