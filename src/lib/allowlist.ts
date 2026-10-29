// Fails closed: an unset or empty list allows nobody.
export function isAllowedEmail(
  email: string | null | undefined,
  raw: string | undefined = process.env.ALLOWED_EMAILS,
): boolean {
  const candidate = email?.trim().toLowerCase();
  if (!candidate || !raw) return false;
  return raw
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
    .includes(candidate);
}
