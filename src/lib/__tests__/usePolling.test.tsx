import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { usePolling } from "@/lib/usePolling";

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => state });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  vi.useFakeTimers();
  setVisibility("visible");
});
afterEach(() => {
  vi.useRealTimers();
});

describe("usePolling", () => {
  it("calls once on mount and again after the interval", async () => {
    const cb = vi.fn();
    renderHook(() => usePolling(cb, 3000));
    expect(cb).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("makes no calls while hidden, and calls once immediately on becoming visible", async () => {
    const cb = vi.fn();
    renderHook(() => usePolling(cb, 3000));
    expect(cb).toHaveBeenCalledTimes(1);
    act(() => setVisibility("hidden"));
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(cb).toHaveBeenCalledTimes(1);
    act(() => setVisibility("visible"));
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("stops on unmount", async () => {
    const cb = vi.fn();
    const { unmount } = renderHook(() => usePolling(cb, 3000));
    unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(cb).toHaveBeenCalledTimes(1);
  });

  it("never overlaps calls", async () => {
    let release: () => void = () => {};
    const cb = vi.fn(() => new Promise<void>((r) => { release = r; }));
    renderHook(() => usePolling(cb, 3000));
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(cb).toHaveBeenCalledTimes(1);
    await act(async () => { release(); await vi.advanceTimersByTimeAsync(3000); });
    expect(cb).toHaveBeenCalledTimes(2);
  });

  it("uses the latest callback without restarting the timer", async () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => usePolling(cb, 3000), { initialProps: { cb: first } });
    await act(async () => { await vi.advanceTimersByTimeAsync(1000); });
    rerender({ cb: second });
    expect(second).not.toHaveBeenCalled();
    await act(async () => { await vi.advanceTimersByTimeAsync(2000); });
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("pauses after 10 minutes without input and resumes at once on the next input", async () => {
    const cb = vi.fn();
    renderHook(() => usePolling(cb, 3000));
    await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000); });
    const atCutoff = cb.mock.calls.length;
    // Mount plus every tick strictly inside the 10 minutes.
    expect(atCutoff).toBe(200);
    await act(async () => { await vi.advanceTimersByTimeAsync(5 * 60_000); });
    expect(cb).toHaveBeenCalledTimes(atCutoff);

    act(() => { window.dispatchEvent(new Event("pointerdown")); });
    expect(cb).toHaveBeenCalledTimes(atCutoff + 1);
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(cb).toHaveBeenCalledTimes(atCutoff + 2);
  });

  it("counts keys, touches and scrolls in any element as activity", async () => {
    const cb = vi.fn();
    renderHook(() => usePolling(cb, 3000));
    const inner = document.createElement("div");
    document.body.appendChild(inner);
    for (const fire of [
      () => window.dispatchEvent(new Event("keydown")),
      () => window.dispatchEvent(new Event("touchstart")),
      // scroll does not bubble, so an inner scroller must still count.
      () => inner.dispatchEvent(new Event("scroll")),
    ]) {
      await act(async () => { await vi.advanceTimersByTimeAsync(9 * 60_000); });
      act(fire);
    }
    // Never idle: 27 minutes of steady ticks plus mount.
    expect(cb).toHaveBeenCalledTimes(1 + (27 * 60_000) / 3000);
    inner.remove();
  });

  it("resumes when the page becomes visible again after idling", async () => {
    const cb = vi.fn();
    renderHook(() => usePolling(cb, 3000));
    await act(async () => { await vi.advanceTimersByTimeAsync(11 * 60_000); });
    const count = cb.mock.calls.length;
    act(() => setVisibility("hidden"));
    act(() => setVisibility("visible"));
    expect(cb).toHaveBeenCalledTimes(count + 1);
    await act(async () => { await vi.advanceTimersByTimeAsync(3000); });
    expect(cb).toHaveBeenCalledTimes(count + 2);
  });

  it("does not resume on input after unmount", async () => {
    const cb = vi.fn();
    const { unmount } = renderHook(() => usePolling(cb, 3000));
    await act(async () => { await vi.advanceTimersByTimeAsync(11 * 60_000); });
    const count = cb.mock.calls.length;
    unmount();
    act(() => { window.dispatchEvent(new Event("pointerdown")); });
    expect(cb).toHaveBeenCalledTimes(count);
  });

  it("makes no calls when disabled", async () => {
    const cb = vi.fn();
    renderHook(() => usePolling(cb, 3000, false));
    await act(async () => { await vi.advanceTimersByTimeAsync(9000); });
    expect(cb).not.toHaveBeenCalled();
  });
});
