import { useEffect, useState } from "react";

export type VisibleArea = { height: number; offsetTop: number; keyboardOpen: boolean };

// Treat a visible area this much shorter than the window as "keyboard open".
// Address-bar changes are well under this; an on-screen keyboard is far over it.
const KEYBOARD_THRESHOLD_PX = 120;

function read(): VisibleArea | null {
  const vv = typeof window === "undefined" ? undefined : window.visualViewport;
  if (!vv) return null;
  return {
    height: vv.height,
    offsetTop: vv.offsetTop,
    keyboardOpen: window.innerHeight - vv.height > KEYBOARD_THRESHOLD_PX,
  };
}

/**
 * The part of the screen the user can actually see. On iOS, 100dvh ignores the
 * on-screen keyboard and the page is panned instead, so a full-screen layout
 * sized in dvh slides its bottom bar out of place. Following visualViewport
 * keeps a fixed layer exactly over the visible area. Null before mount and
 * where the API is missing, so callers fall back to CSS sizing.
 */
export function useVisualViewport(): VisibleArea | null {
  const [area, setArea] = useState<VisibleArea | null>(null);

  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const update = () => setArea(read());
    update();
    vv.addEventListener("resize", update);
    vv.addEventListener("scroll", update);
    return () => {
      vv.removeEventListener("resize", update);
      vv.removeEventListener("scroll", update);
    };
  }, []);

  return area;
}
