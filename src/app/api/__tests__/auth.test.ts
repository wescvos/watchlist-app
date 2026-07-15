import { describe, it, expect, beforeEach } from "vitest";
import { POST } from "@/app/api/auth/route";

beforeEach(() => { process.env.APP_PASSCODE = "secret"; });

describe("POST /api/auth", () => {
  it("rejects wrong passcode", async () => {
    const res = await POST(new Request("http://x/api/auth", { method: "POST", body: JSON.stringify({ passcode: "nope" }) }));
    expect(res.status).toBe(401);
  });
  it("accepts correct passcode and sets cookie", async () => {
    const res = await POST(new Request("http://x/api/auth", { method: "POST", body: JSON.stringify({ passcode: "secret" }) }));
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("wl_auth=");
  });
});
