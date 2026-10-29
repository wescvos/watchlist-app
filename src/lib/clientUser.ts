export const UID_COOKIE = "wl_uid";

/**
 * The signed-in user's id as mirrored into a readable cookie by the proxy, or
 * null on the server or when absent.
 *
 * A cache NAMESPACE only, never proof of being signed in: a denied user's stale
 * cookie can linger. Never use this for an auth decision.
 */
export function readClientUserId(): string | null {
  if (typeof document === "undefined") return null;
  for (const part of document.cookie.split(";")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() !== UID_COOKIE) continue;
    const value = part.slice(eq + 1).trim();
    if (!value) return null;
    try {
      return decodeURIComponent(value);
    } catch {
      return value;
    }
  }
  return null;
}
