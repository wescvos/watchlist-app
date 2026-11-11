import { describe, it, expect, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useVisualViewport } from "@/lib/useVisualViewport";

class FakeVisualViewport extends EventTarget {
  height = 800;
  offsetTop = 0;
}

function install(vv: FakeVisualViewport | undefined, innerHeight = 800) {
  Object.defineProperty(window, "visualViewport", { value: vv, configurable: true });
  Object.defineProperty(window, "innerHeight", { value: innerHeight, configurable: true });
}

afterEach(() => install(undefined));

describe("useVisualViewport", () => {
  it("is null when the browser has no visualViewport, so callers fall back to CSS", () => {
    install(undefined);
    const { result } = renderHook(() => useVisualViewport());
    expect(result.current).toBeNull();
  });

  it("reports the visible area and follows the keyboard opening and closing", () => {
    const vv = new FakeVisualViewport();
    install(vv, 800);
    const { result } = renderHook(() => useVisualViewport());
    expect(result.current).toEqual({ height: 800, offsetTop: 0, keyboardOpen: false });

    act(() => {
      vv.height = 450;
      vv.offsetTop = 120;
      vv.dispatchEvent(new Event("resize"));
    });
    expect(result.current).toEqual({ height: 450, offsetTop: 120, keyboardOpen: true });

    act(() => {
      vv.height = 800;
      vv.offsetTop = 0;
      vv.dispatchEvent(new Event("scroll"));
    });
    expect(result.current?.keyboardOpen).toBe(false);
  });

  it("does not treat a small address-bar change as the keyboard", () => {
    const vv = new FakeVisualViewport();
    vv.height = 740;
    install(vv, 800);
    const { result } = renderHook(() => useVisualViewport());
    expect(result.current?.keyboardOpen).toBe(false);
  });

  it("stops listening on unmount", () => {
    const vv = new FakeVisualViewport();
    install(vv, 800);
    const { result, unmount } = renderHook(() => useVisualViewport());
    unmount();
    vv.height = 300;
    vv.dispatchEvent(new Event("resize"));
    expect(result.current?.height).toBe(800);
  });
});
