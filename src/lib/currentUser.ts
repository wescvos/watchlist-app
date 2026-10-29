import { redirect } from "next/navigation";
import { auth } from "@/auth";
import { isAllowedEmail } from "@/lib/allowlist";

// Re-checks the allowlist on every call so removing a friend from
// ALLOWED_EMAILS locks them out even while their JWT is still valid.
export async function getCurrentUserId(): Promise<string | null> {
  const session = await auth();
  const user = session?.user;
  if (!user?.id || !isAllowedEmail(user.email)) return null;
  return user.id;
}

export async function requireUserId(): Promise<string> {
  const id = await getCurrentUserId();
  if (!id) redirect("/signin");
  return id;
}
