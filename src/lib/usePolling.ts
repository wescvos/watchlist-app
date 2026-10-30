import { useEffect, useRef } from "react";

// A visible but unattended screen (a tablet left open) must not keep the
// database awake, so polling pauses after this long with no input.
const IDLE_MS = 10 * 60_000;
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "touchstart", "scroll"] as const;

/**
 * Runs `callback` on mount, every `intervalMs` while the page is visible, and
 * immediately when the page becomes visible again. Never overlaps: a tick that
 * lands while the previous call is still running is skipped. Pauses after
 * IDLE_MS without pointer, key, touch or scroll input, and resumes with an
 * immediate call on the next such input.
 */
export function usePolling(callback: () => void | Promise<void>, intervalMs: number, enabled = true): void {
  // Ref pattern: a new callback identity each render must not restart the timer,
  // yet every tick must run the latest closure.
  const latest = useRef(callback);
  useEffect(() => {
    latest.current = callback;
  });

  useEffect(() => {
    if (!enabled) return;
    let running = false;
    let cancelled = false;
    let lastInput = Date.now();
    let idle = false;

    async function tick() {
      // Hidden tabs and backgrounded PWAs must not spend requests.
      if (cancelled || running || document.visibilityState !== "visible") return;
      if (Date.now() - lastInput >= IDLE_MS) {
        idle = true;
        return;
      }
      running = true;
      try {
        await latest.current();
      } catch {
        // A failed poll is just a missed tick; the next one retries.
      } finally {
        running = false;
      }
    }

    function onActivity() {
      lastInput = Date.now();
      if (idle) {
        idle = false;
        void tick();
      }
    }

    void tick();
    const id = setInterval(() => void tick(), intervalMs);
    function onVisibility() {
      // Coming back to the app is attention too.
      if (document.visibilityState === "visible") lastInput = Date.now();
      void tick();
    }
    document.addEventListener("visibilitychange", onVisibility);
    // Capture, because scroll does not bubble and threads scroll inside a div.
    const opts = { capture: true, passive: true };
    for (const e of ACTIVITY_EVENTS) window.addEventListener(e, onActivity, opts);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
      for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, onActivity, opts);
    };
  }, [intervalMs, enabled]);
}
