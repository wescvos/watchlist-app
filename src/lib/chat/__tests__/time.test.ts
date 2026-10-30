import { describe, it, expect } from "vitest";
import { formatRelative } from "@/lib/chat/time";

const now = new Date("2026-10-30T12:00:00Z");
const ago = (ms: number) => new Date(now.getTime() - ms).toISOString();

describe("formatRelative", () => {
  it("says now under a minute, including future skew", () => {
    expect(formatRelative(ago(30_000), now)).toBe("now");
    expect(formatRelative(ago(-5_000), now)).toBe("now");
  });
  it("uses minutes, hours and days", () => {
    expect(formatRelative(ago(60_000), now)).toBe("1m");
    expect(formatRelative(ago(59 * 60_000), now)).toBe("59m");
    expect(formatRelative(ago(60 * 60_000), now)).toBe("1h");
    expect(formatRelative(ago(23 * 3_600_000), now)).toBe("23h");
    expect(formatRelative(ago(24 * 3_600_000), now)).toBe("1d");
    expect(formatRelative(ago(3 * 24 * 3_600_000), now)).toBe("3d");
  });
});
