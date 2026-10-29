// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("next-auth", () => ({ default: vi.fn(() => ({ handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn() })) }));
vi.mock("next-auth/providers/google", () => ({ default: {} }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { upsert: vi.fn() } } }));

import { prisma } from "@/lib/prisma";
import { authCallbacks } from "@/auth";

const upsert = prisma.user.upsert as unknown as ReturnType<typeof vi.fn>;

describe("authCallbacks", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubEnv("ALLOWED_EMAILS", "wesley@vosk.co.za");
    upsert.mockResolvedValue({ id: "u1" });
  });

  it("signIn allows a verified, allowlisted email", () => {
    expect(authCallbacks.signIn({ user: { email: "wesley@vosk.co.za" }, profile: { email_verified: true } })).toBe(true);
  });

  it("signIn rejects an unverified email even if allowlisted", () => {
    expect(authCallbacks.signIn({ user: { email: "wesley@vosk.co.za" }, profile: { email_verified: false } })).toBe(false);
  });

  it("signIn rejects when the profile is missing", () => {
    expect(authCallbacks.signIn({ user: { email: "wesley@vosk.co.za" } })).toBe(false);
  });

  it("signIn rejects a verified email that is not allowlisted", () => {
    expect(authCallbacks.signIn({ user: { email: "x@example.com" }, profile: { email_verified: true } })).toBe(false);
  });

  it("jwt lowercases the email before upserting and stores the user id", async () => {
    const token = await authCallbacks.jwt({
      token: {},
      user: { email: "Wesley@Vosk.co.za", name: "W", image: null },
    });
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: "wesley@vosk.co.za" } }),
    );
    expect(token.uid).toBe("u1");
  });

  it("jwt leaves the token alone on later calls", async () => {
    const token = await authCallbacks.jwt({ token: { uid: "u1" } });
    expect(upsert).not.toHaveBeenCalled();
    expect(token.uid).toBe("u1");
  });

  it("session copies uid onto session.user.id", () => {
    const s = authCallbacks.session({ session: { user: { id: "" } }, token: { uid: "u1" } });
    expect(s.user.id).toBe("u1");
  });
});
