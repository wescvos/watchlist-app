import { describe, it, expect, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
import { sha256Hex } from "@/lib/hash";

function req(path: string, cookie?: string) {
  return new NextRequest(new URL(`http://localhost${path}`), cookie ? { headers: { cookie } } : undefined);
}

afterEach(() => { delete process.env.APP_PASSCODE; });

describe("middleware auth (fail-closed)", () => {
  it("denies with a redirect to /gate when APP_PASSCODE is unset, even if the cookie holds the empty-string hash", async () => {
    delete process.env.APP_PASSCODE;
    const emptyHash = await sha256Hex("");
    const res = await middleware(req("/", `wl_auth=${emptyHash}`));
    expect(res.headers.get("location")).toContain("/gate");
  });
  it("401s unauthenticated API requests when a passcode IS configured", async () => {
    process.env.APP_PASSCODE = "secret";
    const res = await middleware(req("/api/titles"));
    expect(res.status).toBe(401);
  });
  it("allows the request through with the correct hash cookie", async () => {
    process.env.APP_PASSCODE = "secret";
    const res = await middleware(req("/", `wl_auth=${await sha256Hex("secret")}`));
    expect(res.headers.get("location")).toBeNull();
  });
});
