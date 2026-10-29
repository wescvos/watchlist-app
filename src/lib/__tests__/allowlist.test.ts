import { describe, it, expect } from "vitest";
import { isAllowedEmail } from "@/lib/allowlist";

describe("isAllowedEmail", () => {
  const raw = "a@x.com, b@y.com";

  it("allows listed emails, case-insensitively and trimmed", () => {
    expect(isAllowedEmail("a@x.com", raw)).toBe(true);
    expect(isAllowedEmail("B@Y.com", raw)).toBe(true);
    expect(isAllowedEmail(" b@y.com ", raw)).toBe(true);
  });

  it("denies unlisted and missing emails", () => {
    expect(isAllowedEmail("c@z.com", "a@x.com")).toBe(false);
    expect(isAllowedEmail(null, raw)).toBe(false);
    expect(isAllowedEmail(undefined, raw)).toBe(false);
    expect(isAllowedEmail("", raw)).toBe(false);
  });

  it("fails closed when the list is unset or empty", () => {
    expect(isAllowedEmail("a@x.com", undefined)).toBe(false);
    expect(isAllowedEmail("a@x.com", "")).toBe(false);
    expect(isAllowedEmail("", "")).toBe(false);
  });
});
