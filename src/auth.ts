import type { JWT } from "next-auth/jwt";
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import { prisma } from "@/lib/prisma";
import { isAllowedEmail } from "@/lib/allowlist";

export const authCallbacks = {
  // Returning false makes Auth.js redirect to /signin?error=AccessDenied.
  // Google must vouch for the address: the owner email is not a Gmail one, so an
  // unverified Google account could otherwise present it and reach the owner's row.
  signIn({ user, profile }: { user: { email?: string | null }; profile?: { email_verified?: boolean | null } }) {
    return profile?.email_verified === true && isAllowedEmail(user.email);
  },
  // `user` is only present on the first sign-in; later calls reuse token.uid.
  async jwt({ token, user }: { token: JWT; user?: { email?: string | null; name?: string | null; image?: string | null } }) {
    if (user?.email) {
      const email = user.email.toLowerCase();
      const dbUser = await prisma.user.upsert({
        where: { email },
        update: { name: user.name, image: user.image },
        create: { email, name: user.name, image: user.image },
      });
      token.uid = dbUser.id;
    }
    return token;
  },
  session<S extends { user: { id: string } }>({ session, token }: { session: S; token: JWT }): S {
    if (token.uid) session.user.id = token.uid;
    return session;
  },
};

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],
  session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 365 },
  pages: { signIn: "/signin", error: "/signin" },
  callbacks: authCallbacks,
});
