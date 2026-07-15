import { NextResponse } from "next/server";
import { updateTitle, deleteTitle } from "@/lib/titles";
import { Status } from "@prisma/client";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const patch: { status?: Status; note?: string | null; myRating?: number | null } = {};
  if (body.status === "WANT" || body.status === "WATCHED") patch.status = body.status;
  if (typeof body.note === "string" || body.note === null) patch.note = body.note;
  if (body.myRating === null || (Number.isInteger(body.myRating) && body.myRating >= 0 && body.myRating <= 10)) {
    patch.myRating = body.myRating;
  }
  try {
    return NextResponse.json(await updateTitle(id, patch));
  } catch {
    return NextResponse.json({ error: "Update failed" }, { status: 404 });
  }
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await deleteTitle(id);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "Delete failed" }, { status: 404 });
  }
}
