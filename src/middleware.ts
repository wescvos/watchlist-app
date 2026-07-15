import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { sha256Hex } from "@/lib/hash";

export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const isPublic = pathname === "/gate" || pathname === "/api/auth";
  if (isPublic) return NextResponse.next();

  const expected = await sha256Hex(process.env.APP_PASSCODE ?? "");
  const authed = req.cookies.get("wl_auth")?.value === expected;
  if (authed) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const url = req.nextUrl.clone();
  url.pathname = "/gate";
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icons).*)"],
};
