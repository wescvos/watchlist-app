import { NextResponse } from "next/server";
import { searchTitles } from "@/lib/tmdb";

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ error: "Missing q" }, { status: 400 });
  try {
    return NextResponse.json(await searchTitles(q));
  } catch (e) {
    return NextResponse.json({ error: "Search failed" }, { status: 502 });
  }
}
