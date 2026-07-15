import { NextResponse } from "next/server";
import { updateTitle, deleteTitle } from "@/lib/titles";
import { Status } from "@prisma/client";

function isNotFound(e: unknown): boolean {
  return typeof e === "object" && e !== null && (e as { code?: string }).code === "P2025";
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const patch: { status?: Status; note?: string | null; myRating?: number | null } = {};
  if ("status" in body) {
    if (body.status !== "WANT" && body.status !== "WATCHED") {
      return NextResponse.json({ error: "status must be WANT or WATCHED" }, { status: 400 });
    }
    patch.status = body.status;
  }
  if ("note" in body) {
    if (body.note !== null && typeof body.note !== "string") {
      return NextResponse.json({ error: "note must be a string or null" }, { status: 400 });
    }
    patch.note = body.note;
  }
  if ("myRating" in body) {
    const r = body.myRating;
    const ok = r === null || (Number.isInteger(r) && r >= 0 && r <= 10);
    if (!ok) {
      return NextResponse.json({ error: "myRating must be an integer 0-10 or null" }, { status: 400 });
    }
    patch.myRating = r;
  }
  try {
    return NextResponse.json(await updateTitle(id, patch));
  } catch (e) {
    if (isNotFound(e)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await deleteTitle(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (isNotFound(e)) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
