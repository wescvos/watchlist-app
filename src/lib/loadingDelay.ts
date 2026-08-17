/**
 * How long to withhold a loading placeholder before showing it.
 *
 * Since the lists seed from localStorage, data usually arrives within a frame or
 * two. An immediate placeholder therefore appeared and vanished a third of a
 * second later: two different screens in quick succession, which reads as a
 * glitch rather than as loading. Below this threshold we render nothing and go
 * straight from empty to content; only a genuinely slow load crosses it, which
 * is exactly when a placeholder earns its place.
 *
 * Shared by Home's grid skeleton and the search page's poster wall so the two
 * cannot drift apart. Comfortably inside the ~200ms that still reads as
 * instant, while long enough to cover a disk-seeded launch.
 */
export const LOADING_DELAY_MS = 180;
