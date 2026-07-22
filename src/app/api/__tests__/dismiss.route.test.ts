import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/recommendations", () => ({ dismissTitle: vi.fn() }));

import { POST } from "@/app/api/recommendations/dismiss/route";
import { dismissTitle } from "@/lib/recommendations";

const dismissMock = vi.mocked(dismissTitle);

function post(body: unknown) {
  return POST(new Request("http://x/api/recommendations/dismiss", { method: "POST", body: JSON.stringify(body) }));
}

beforeEach(() => vi.clearAllMocks());

describe("POST /api/recommendations/dismiss", () => {
  it("records a dismissal and returns ok", async () => {
    dismissMock.mockResolvedValue();
    const res = await post({ tmdbId: 42, mediaType: "MOVIE" });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(dismissMock).toHaveBeenCalledWith(42, "MOVIE");
  });

  it("rejects a missing/invalid tmdbId or mediaType with 400", async () => {
    const bad = await post({ mediaType: "MOVIE" });
    expect(bad.status).toBe(400);
    const badType = await post({ tmdbId: 42, mediaType: "PODCAST" });
    expect(badType.status).toBe(400);
    expect(dismissMock).not.toHaveBeenCalled();
  });
});
