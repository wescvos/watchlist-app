// TEMP navigation diagnostics for the back-nav flash + double-back. Remove once
// the mechanism is confirmed. Every log carries a timestamp, the current
// pathname, and history.length, so across repeated mutate-then-back cycles we
// can watch whether the history stack GROWS (→ the extra back step) and whether
// a page RE-MOUNTS with empty data for a frame (→ the blank flash), on both the
// home and search flows.

export function logNav(tag: string, data: Record<string, unknown> = {}): void {
  if (typeof window === "undefined") return;
  const extra = Object.entries(data)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  console.log(
    `[${tag} t=${Math.round(performance.now())}ms path=${location.pathname} hist=${history.length}]${extra ? " " + extra : ""}`,
  );
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
