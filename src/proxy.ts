import { NextResponse } from "next/server";
import type { NextAuthRequest } from "next-auth";
import { auth } from "@/auth";
import { isAllowedEmail } from "@/lib/allowlist";
import { UID_COOKIE } from "@/lib/clientUser";

const ONE_YEAR = 60 * 60 * 24 * 365;

function isPublic(pathname: string) {
  return pathname === "/signin" || pathname.startsWith("/api/auth/");
}

export function handleProxy(req: NextAuthRequest): NextResponse {
  const { pathname } = req.nextUrl;
  if (isPublic(pathname)) return NextResponse.next();

  // A session for an email that has left the allowlist counts as signed out.
  const user = req.auth?.user;
  if (!user?.id || !isAllowedEmail(user.email)) {
    if (pathname.startsWith("/api/")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const url = req.nextUrl.clone();
    url.pathname = "/signin";
    url.search = "";
    return NextResponse.redirect(url);
  }

  const res = NextResponse.next();
  if (req.cookies.get(UID_COOKIE)?.value !== user.id) {
    res.cookies.set(UID_COOKIE, user.id, {
      httpOnly: false,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: ONE_YEAR,
    });
  }
  return res;
}

export const proxy = auth(handleProxy);

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|manifest.webmanifest|icons).*)"],
};
