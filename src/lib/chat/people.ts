import { prisma } from "@/lib/prisma";
import { isAllowedEmail } from "@/lib/allowlist";

export type Person = { id: string; firstName: string; image: string | null };

export function firstNameOf(user: { name: string | null; email: string }): string {
  const word = user.name?.trim().split(/\s+/)[0];
  return word || user.email.split("@")[0];
}

// Emails are read only to apply the allowlist and are never returned, so the
// people list cannot leak them to other users.
export async function listPeople(excludeUserId: string): Promise<Person[]> {
  const users = await prisma.user.findMany({
    select: { id: true, email: true, name: true, image: true },
  });
  return users
    .filter((u) => u.id !== excludeUserId && isAllowedEmail(u.email))
    .map((u) => ({ id: u.id, firstName: firstNameOf(u), image: u.image }))
    .sort((a, b) => a.firstName.localeCompare(b.firstName));
}

// "On the app" means a User row that is still on the allowlist, so removing
// someone from ALLOWED_EMAILS also removes them from chat.
export async function isActiveUser(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { email: true },
  });
  return !!user && isAllowedEmail(user.email);
}
