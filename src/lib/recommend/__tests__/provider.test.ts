import { describe, it, expect } from "vitest";
import { getProvider } from "@/lib/recommend/provider";
import { GEMINI_MODEL } from "@/lib/recommend/gemini";

describe("getProvider", () => {
  it("returns a provider exposing a recommend() and a non-empty model", () => {
    const p = getProvider();
    expect(typeof p.recommend).toBe("function");
    expect(p.model).toBe(GEMINI_MODEL);
    expect(p.model).toBeTruthy();
  });
});
