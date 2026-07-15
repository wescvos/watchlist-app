import { describe, it, expect, afterEach } from "vitest";
import { getEnv } from "@/lib/env";

afterEach(() => { delete process.env.TEST_KEY; });

describe("getEnv", () => {
  it("returns a set variable", () => {
    process.env.TEST_KEY = "hello";
    expect(getEnv("TEST_KEY")).toBe("hello");
  });
  it("throws when missing", () => {
    expect(() => getEnv("TEST_KEY")).toThrow(/TEST_KEY/);
  });
});
