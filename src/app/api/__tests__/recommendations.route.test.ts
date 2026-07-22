import { describe, it, expect, vi, beforeEach } from "vitest";

// Stub the DB adapter so importing the route (→ service → prisma) never opens a
// real connection.
vi.mock("@/lib/prisma", () => ({ prisma: {} }));
vi.mock("@/lib/recommendations", () => ({ getLatestRecommendationSet: vi.fn() }));
// Keep the real RecommendationError (so `instanceof` + `kind` work in the
// route) but stub the generate function.
vi.mock("@/lib/recommend/service", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/recommend/service")>();
  return { ...actual, generateRecommendations: vi.fn() };
});

import { GET, POST } from "@/app/api/recommendations/route";
import { getLatestRecommendationSet } from "@/lib/recommendations";
import { generateRecommendations, RecommendationError } from "@/lib/recommend/service";

const getLatest = vi.mocked(getLatestRecommendationSet);
const generate = vi.mocked(generateRecommendations);

beforeEach(() => vi.clearAllMocks());

describe("GET /api/recommendations", () => {
  it("returns the latest cached set", async () => {
    const set = { id: "s1", suggestions: [], model: "m", sourceCount: 2, generatedAt: new Date() };
    getLatest.mockResolvedValue(set as unknown as Awaited<ReturnType<typeof getLatestRecommendationSet>>);
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe("s1");
  });

  it("returns null when nothing has been generated, and never generates", async () => {
    getLatest.mockResolvedValue(null);
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toBeNull();
    expect(generate).not.toHaveBeenCalled();
  });
});

describe("POST /api/recommendations", () => {
  it("returns the new set on success", async () => {
    generate.mockResolvedValue({ empty: false, set: { id: "new" } as unknown as never });
    const res = await POST();
    expect(res.status).toBe(200);
    expect((await res.json()).id).toBe("new");
  });

  it("returns 200 { empty: true } for empty rating history (not a 4xx)", async () => {
    generate.mockResolvedValue({ empty: true, set: null });
    const res = await POST();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ empty: true });
  });

  it("maps a provider failure to 502", async () => {
    generate.mockRejectedValue(new RecommendationError("boom"));
    const res = await POST();
    expect(res.status).toBe(502);
  });

  it("maps a timeout to 504", async () => {
    generate.mockRejectedValue(new RecommendationError("timed out", "timeout"));
    const res = await POST();
    expect(res.status).toBe(504);
  });

  it("maps a rate-limit (429) to a distinct 429 with an honest message", async () => {
    generate.mockRejectedValue(new RecommendationError("rate limited", "rate_limit"));
    const res = await POST();
    expect(res.status).toBe(429);
    expect((await res.json()).error).toMatch(/today's recommendation limit/i);
  });
});
