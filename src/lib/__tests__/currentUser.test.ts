// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach, type Mock } from "vitest";

vi.mock("@/auth", () => ({ auth: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/prisma", () => ({ prisma: { user: { upsert: vi.fn() } } }));
vi.mock("next-auth", () => ({ default: vi.fn() }));
vi.mock("next-auth/providers/google", () => ({ default: {} }));

import { auth } from "@/auth";
import { redirect } from "next/navigation";
import { getCurrentUserId, requireUserId } from "@/lib/currentUser";

const authMock = auth as unknown as Mock;

describe("current user helpers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ALLOWED_EMAILS = "a@x.com";
  });
  afterEach(() => {
    delete process.env.ALLOWED_EMAILS;
  });

  it("returns the user id for an allowed session", async () => {
    authMock.mockResolvedValue({ user: { id: "u1", email: "a@x.com" } });
    expect(await getCurrentUserId()).toBe("u1");
  });

  it("returns null when the email was removed from the allowlist", async () => {
    process.env.ALLOWED_EMAILS = "b@y.com";
    authMock.mockResolvedValue({ user: { id: "u1", email: "a@x.com" } });
    expect(await getCurrentUserId()).toBeNull();
  });

  it("returns null for no session or a session without an id", async () => {
    authMock.mockResolvedValue(null);
    expect(await getCurrentUserId()).toBeNull();
    authMock.mockResolvedValue({ user: { email: "a@x.com" } });
    expect(await getCurrentUserId()).toBeNull();
  });

  it("requireUserId redirects to /signin without a session", async () => {
    authMock.mockResolvedValue(null);
    await requireUserId();
    expect(redirect).toHaveBeenCalledWith("/signin");
  });
});
