// TEMP navigation diagnostics for the back-nav flash + double-back. Remove once
// the mechanism is confirmed. Every log carries a timestamp, the current
// pathname, and history.length, so across repeated mutate-then-back cycles we
// can watch whether the history stack GROWS (→ the extra back step) and whether
// a page RE-MOUNTS with empty data for a frame (→ the blank flash), on both the
// home and search flows.
//
// Logs go to console AND to an on-screen buffer (rendered by NavDebugOverlay),
// so they can be read/screenshotted directly on the phone without remote
// debugging.

const logLines: string[] = [];
let version = 0;
const listeners = new Set<() => void>();

export function getNavDebugLines(): string[] {
  return logLines;
}
export function getNavDebugVersion(): number {
  return version;
}
export function subscribeNavDebug(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function record(line: string): void {
  logLines.push(line);
  if (logLines.length > 40) logLines.shift();
  version++;
  listeners.forEach((l) => l());
}

export function logNav(tag: string, data: Record<string, unknown> = {}): void {
  if (typeof window === "undefined") return;
  const extra = Object.entries(data)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  const line = `${tag} t=${Math.round(performance.now())}ms path=${location.pathname} hist=${history.length}${extra ? " " + extra : ""}`;
  console.log(`[${line}]`);
  record(line);
}

// Installed once (guarded on window) so the global popstate/pageshow listeners
// aren't duplicated across page mounts.
export function installNavDebug(): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __navDebugInstalled?: boolean };
  if (w.__navDebugInstalled) return;
  w.__navDebugInstalled = true;
  window.addEventListener("popstate", () => logNav("popstate"));
  window.addEventListener("pageshow", () => logNav("pageshow"));
  logNav("install");
}
