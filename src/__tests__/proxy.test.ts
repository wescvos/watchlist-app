import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/auth", () => ({ auth: (fn: unknown) => fn }));

import { handleProxy } from "@/proxy";

type Sess = { expires: string; user: { id: string; email: string } } | null;

function req(path: string, session: Sess, cookie?: string) {
  const r = new NextRequest(`http://localhost${path}`, {
    headers: cookie ? { cookie } : undefined,
  }) as NextRequest & { auth: Sess };
  r.auth = session;
  return r;
}

const ok: Sess = { expires: "2099-01-01", user: { id: "u1", email: "a@x.com" } };

describe("handleProxy", () => {
  beforeEach(() => {
    process.env.ALLOWED_EMAILS = "a@x.com";
  });

  it("lets /signin and auth callbacks through without a session", () => {
    expect(handleProxy(req("/signin", null)).status).toBe(200);
    expect(handleProxy(req("/api/auth/callback/google", null)).status).toBe(200);
  });

  it("redirects pages to /signin without a session", () => {
    const res = handleProxy(req("/", null));
    expect(res.status).toBe(307);
    expect(new URL(res.headers.get("location")!).pathname).toBe("/signin");
  });

  it("returns 401 JSON for API routes without a session", async () => {
    const res = handleProxy(req("/api/titles", null));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Unauthorized" });
  });

  it("treats a session whose email is not allowed as no session", () => {
    const bad = { expires: "2099-01-01", user: { id: "u2", email: "evil@x.com" } };
    expect(handleProxy(req("/", bad)).status).toBe(307);
    expect(handleProxy(req("/api/titles", bad)).status).toBe(401);
  });

  it("sets wl_uid for a valid session when the cookie is missing or different", () => {
    const res = handleProxy(req("/", ok));
    expect(res.status).toBe(200);
    expect(res.cookies.get("wl_uid")?.value).toBe("u1");
    const res2 = handleProxy(req("/", ok, "wl_uid=other"));
    expect(res2.cookies.get("wl_uid")?.value).toBe("u1");
  });

  it("does not set wl_uid when it already matches", () => {
    const res = handleProxy(req("/", ok, "wl_uid=u1"));
    expect(res.status).toBe(200);
    expect(res.cookies.get("wl_uid")).toBeUndefined();
  });
});
