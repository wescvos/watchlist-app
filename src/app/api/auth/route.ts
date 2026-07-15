import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { sha256Hex } from "@/lib/hash";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  if (body?.passcode !== env.passcode) {
    return NextResponse.json({ error: "Incorrect passcode" }, { status: 401 });
  }
  const res = NextResponse.json({ ok: true });
  res.cookies.set("wl_auth", await sha256Hex(env.passcode), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // 1 year — "remember this device"
  });
  return res;
}
