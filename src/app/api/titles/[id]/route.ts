import { NextResponse } from "next/server";
import { updateTitle, deleteTitle } from "@/lib/titles";
import { getCurrentUserId } from "@/lib/currentUser";
import { Status } from "@prisma/client";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }
  const patch: { status?: Status; note?: string | null; myRating?: number | null; pinned?: boolean } = {};
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
    const ok = r === null || (Number.isInteger(r) && r >= 1 && r <= 10);
    if (!ok) {
      return NextResponse.json({ error: "myRating must be an integer 1-10 or null" }, { status: 400 });
    }
    patch.myRating = r;
  }
  if ("pinned" in body) {
    if (typeof body.pinned !== "boolean") {
      return NextResponse.json({ error: "pinned must be a boolean" }, { status: 400 });
    }
    patch.pinned = body.pinned;
  }
  try {
    const updated = await updateTitle(userId, id, patch);
    if (!updated) return NextResponse.json({ error: "Not found" }, { status: 404 });
    return NextResponse.json(updated);
  } catch {
    return NextResponse.json({ error: "Update failed" }, { status: 500 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getCurrentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { id } = await params;
  try {
    if (!(await deleteTitle(userId, id))) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Delete failed" }, { status: 500 });
  }
}
