import { NextResponse } from "next/server";
import { refreshTitle } from "@/lib/titles";

export async function POST(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    return NextResponse.json(await refreshTitle(id));
  } catch {
    return NextResponse.json({ error: "Refresh failed" }, { status: 502 });
  }
}
