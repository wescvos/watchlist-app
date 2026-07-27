"use client";
import { useSyncExternalStore } from "react";
import { getNavDebugLines, getNavDebugVersion, subscribeNavDebug } from "@/lib/navDebug";

// TEMP on-screen diagnostics panel — shows the nav-debug log lines directly on
// the device (no remote debugging needed). pointer-events-none so it never
// blocks taps. Remove along with navDebug once the back-nav bug is root-caused.
export function NavDebugOverlay() {
  useSyncExternalStore(subscribeNavDebug, getNavDebugVersion, () => 0);
  const lines = getNavDebugLines();
  if (lines.length === 0) return null;
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-50 max-h-[45vh] overflow-hidden border-t border-green-500/30 bg-black/85 p-1 font-mono text-[9px] leading-tight text-green-300">
      {lines.slice(-16).map((l, i) => (
        <div key={i} className="whitespace-pre-wrap break-all">{l}</div>
      ))}
    </div>
  );
}
