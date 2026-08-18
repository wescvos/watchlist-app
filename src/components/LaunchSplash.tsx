"use client";
import { useEffect, useState } from "react";

/**
 * The launch splash: black screen, centred popcorn mark, gone in about half a
 * second.
 *
 * THIS IS A COVER, NOT A FIX. The launch flicker was investigated and the
 * obvious culprits ruled out: the background revalidation mutates zero DOM when
 * data is unchanged, cards are keyed by a stable id so nothing remounts, and the
 * poster src is byte-identical across renders. It also looks the same on a quick
 * reopen as on a cold one, which rules out image caching. The remaining
 * suspect is the iOS PWA launch sequence itself, which the app cannot reach. So
 * rather than keep chasing it, this turns an unexplained flicker into an
 * intentional moment, which is what native apps do.
 *
 * TWO MECHANISMS COVER TWO DIFFERENT WINDOWS, and neither covers both:
 *
 *   1. `apple-touch-startup-image` (see layout.tsx and scripts/gen-splash.ts)
 *      covers home-screen tap until first paint. No component can cover that
 *      window, because React is not running in it.
 *   2. This component covers first paint until the list is actually on screen.
 *
 * The seam between them is why this renders in the SERVER HTML rather than
 * mounting after hydration: it is in the very first painted frame, so the native
 * image hands over to an identical black screen instead of to a half-built page.
 * A splash that waited for hydration would expose exactly the moment it exists
 * to hide.
 */

// Long enough to read as deliberate rather than as a glitch.
const MIN_VISIBLE_MS = 500;
// If the list is genuinely slow (a first-ever launch with an empty cache), stop
// waiting and let the normal skeleton take over. Erring longer than MIN keeps the
// jitter covered; erring too long would just be a slow app.
const MAX_VISIBLE_MS = 1600;
// Matches the fade below. The reduced-motion rule in globals.css collapses every
// transition to ~0ms globally, so that preference is honoured without a bespoke
// check here.
const FADE_MS = 220;

// Module scope, so it survives a Home remount the same way listCache does. This
// is what keeps the splash off client-side navigation: tapping into a title and
// back must never show it again.
let shownThisSession = false;

export function LaunchSplash({ ready }: { ready: boolean }) {
  // Read once at mount. On the initial load this is false on both server and
  // client, so both render the splash and hydration matches. On a later
  // client-side navigation the module flag is already set, so nothing renders.
  const [showable] = useState(() => !shownThisSession);
  const [minElapsed, setMinElapsed] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const [removed, setRemoved] = useState(false);

  // Derived rather than stored, so the "ready" path needs no state write.
  const hidden = (minElapsed && ready) || timedOut;

  useEffect(() => {
    if (!showable) return;
    shownThisSession = true;
    const min = setTimeout(() => setMinElapsed(true), MIN_VISIBLE_MS);
    const max = setTimeout(() => setTimedOut(true), MAX_VISIBLE_MS);
    return () => {
      clearTimeout(min);
      clearTimeout(max);
    };
  }, [showable]);

  // Unmount only after the fade, so the element is not left sitting at opacity 0.
  useEffect(() => {
    if (!hidden) return;
    const t = setTimeout(() => setRemoved(true), FADE_MS);
    return () => clearTimeout(t);
  }, [hidden]);

  if (!showable || removed) return null;

  return (
    <div
      // aria-hidden plus no text: it is a decorative cover, and a screen reader
      // should be reading the list underneath rather than announcing a logo.
      aria-hidden="true"
      className={`fixed inset-0 z-50 flex items-center justify-center bg-[#0a0a0a] transition-opacity duration-200 ${
        hidden ? "pointer-events-none opacity-0" : "opacity-100"
      }`}
    >
      {/* Inline rather than an <img>: an image request could resolve after the
          frame we are trying to cover. 6rem on a ~390px screen is roughly the
          22% of the shorter edge the generated launch images use, so the mark
          does not visibly change size at the handover. */}
      <svg viewBox="0 0 512 512" className="h-24 w-24 text-white" fill="currentColor" aria-hidden="true">
        <path d="M209 19.39c-16.9 2.15-23 19.58-29.7 33.81-15.5-5.07-38.7-11.67-48.3-4-2.3 2.31-4.3 7.35-5 14.31-.6 6.95-.1 15.42 1 23.45 1.5 10.37 3.9 19.94 5.3 25.24 10.3 4.2 17.8 10.7 21.8 18.3 5.3 9.8 5 21.6-1.9 29.9l-13.8-11.6c1.5-1.8 2.3-5.3-.1-9.8-10.4-11.1-50.17-26.9-63.92-13.1-1.29 1.5-2.69 5-2.96 10.4-.26 5.3.52 12 1.79 18.3 1.65 8.5 3.64 14.8 5.09 19 108.4 15.5 151.1 21.4 208.3 18 1-4.5 2.8-11.6 5.7-19.8 4.6-12.8 10.3-27.7 23-35.4 11-5.5 22.9-3.9 33.4-1.5 2.3-6.4 6.2-13.4 10.9-16.7 12.8-7.3 28.8-2.1 41.7 1.9l-7.4 13.3c-7.5-3.8-17.1-5.5-24.2-.3-6.3 4.6-7.6 16.4-10.7 22.9-8.4-1.9-26.4-8.4-34.3-4.2-4.4 2.3-11.4 14.6-15.4 26-1.6 4.5-2.9 8.8-3.9 12.5 32.3-2.8 71-8.2 127.9-16 6.3-7 18-23.3 17-30.7-13-5.3-27.9-3-41.7-2.2 5.6-10.4 19.9-24.4 18.7-36.3-13.9-11.21-41-8.41-56.3-7.11-1.3-13.56-6.4-45.29-16.2-51.29-20.4-2.19-37.7 8.35-55.5 18.48-2.7-10.73-6.4-36.42-15.9-39.07-14.2-3.96-27.2 4.31-40.5 10.82-12.2-7.94-26.9-18.44-33.9-17.54zm173.2 39.86c1.9 6.38 3.4 13.3 4.5 19.59 10.2-.11 19.3.21 28.6 1.9-.9-7.53-2.4-17.9-8.5-22.35-8.6-3.56-16.8-1.65-24.6.86zm-174.7 4.14c15.3 6.11 20.1 24.04 22.9 37.61 11.6-5.08 26.8-9.48 37.1-3.66 14.9 10.86 16 33.96 15.9 48.86l-18-.4c-.5-10-.4-18.5-3.9-28-1.5-4.6-4.4-5.7-8.5-5.2-13.3 2.1-24.9 9.3-36.8 16.1-1.8-13.2-1.1-45.12-13.9-48.1-12.5-2.91-23.8 13.25-32.7 23.4l-13.8-11.63c11.8-12.27 33-34.25 51.7-28.98zM87.62 88.25c-.43 4.61 0 10.47.91 16.35 8.47.1 16.27 1.3 24.07 2.8-2.4-10.47-3.9-19.81-4.7-29.74-10.58-2.27-19.11-.87-20.28 10.59zM76.29 191.5 135.4 487H182l-13.9-139.1c-10.5-10-17.1-22.2-17.1-35.9 0-10.6 4-20.3 10.6-28.8l-8.1-81c-21.9-2.9-47-6.4-77.21-10.7zm359.31.7c-30.2 4.2-55.3 7.6-77.2 10.4l-8 80.6c6.6 8.4 10.6 18.2 10.6 28.8 0 13.7-6.6 25.9-17.1 35.9L330 487h46.6zm-263.7 12.3 6.4 63.5c1.7-1.2 3.5-2.3 5.3-3.4 17-9.9 39.1-16.1 63.4-17.4v-36.9c-22.6-.4-45.9-2.4-75.1-5.8zm168.1.3c-29 3.4-52.3 5.2-75 5.6v36.8c24.3 1.3 46.4 7.5 63.4 17.4 1.8 1.1 3.6 2.2 5.3 3.4zM256 265c-25.1 0-47.7 6-63.3 15.2C177 289.3 169 300.7 169 312s8 22.7 23.7 31.8C208.3 353 230.9 359 256 359c25.1 0 47.7-6 63.3-15.2C335 334.7 343 323.3 343 312s-8-22.7-23.7-31.8C303.7 271 281.1 265 256 265zm-68.4 96.6L200.2 487H247V376.8c-22.5-1.2-43-6.6-59.4-15.2zm136.7 0c-16.4 8.6-36.9 14-59.3 15.2V487h46.8z" />
      </svg>
    </div>
  );
}
