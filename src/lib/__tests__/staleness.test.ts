import { describe, it, expect } from "vitest";
import { isStale } from "@/lib/titles";

describe("isStale", () => {
  const now = new Date("2026-07-14T00:00:00Z");
  it("false when fetched 29 days ago", () => {
    const d = new Date(now); d.setDate(d.getDate() - 29);
    expect(isStale(d, now)).toBe(false);
  });
  it("true when fetched 31 days ago", () => {
    const d = new Date(now); d.setDate(d.getDate() - 31);
    expect(isStale(d, now)).toBe(true);
  });
});
