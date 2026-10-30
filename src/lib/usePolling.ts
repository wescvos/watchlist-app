import { useEffect, useRef } from "react";

/**
 * Runs `callback` on mount, every `intervalMs` while the page is visible, and
 * immediately when the page becomes visible again. Never overlaps: a tick that
 * lands while the previous call is still running is skipped.
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

    async function tick() {
      // Hidden tabs and backgrounded PWAs must not spend requests.
      if (cancelled || running || document.visibilityState !== "visible") return;
      running = true;
      try {
        await latest.current();
      } catch {
        // A failed poll is just a missed tick; the next one retries.
      } finally {
        running = false;
      }
    }

    void tick();
    const id = setInterval(() => void tick(), intervalMs);
    function onVisibility() {
      void tick();
    }
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [intervalMs, enabled]);
}
