import { NextResponse } from "next/server";
import { getLatestRecommendationSet } from "@/lib/recommendations";
import { generateRecommendations, RecommendationError } from "@/lib/recommend/service";

// Latest cached set (or null if never generated). Never generates or writes;
// opening the screen is always instant and side-effect-free.
export async function GET() {
  const set = await getLatestRecommendationSet();
  return NextResponse.json(set);
}

// Manual refresh: regenerate and cache. Empty rating history is a valid state
// (200 { empty: true }, no provider call), a timeout is 504, and every other
// failure is 502. Never throws to the client.
export async function POST() {
  try {
    const result = await generateRecommendations();
    if (result.empty) return NextResponse.json({ empty: true });
    return NextResponse.json(result.set);
  } catch (e) {
    // Server-side breadcrumb so a generation failure isn't fully silent (the
    // client only sees a generic 502/504).
    console.error(
      "[api/recommendations] POST failed:",
      e instanceof RecommendationError ? `${e.name}(${e.kind}): ${e.message}` : e,
    );
    if (e instanceof RecommendationError && e.kind === "timeout") {
      return NextResponse.json({ error: "Recommendations timed out. Try again." }, { status: 504 });
    }
    return NextResponse.json({ error: "Couldn't generate recommendations." }, { status: 502 });
  }
}
