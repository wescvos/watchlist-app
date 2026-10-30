import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/prisma", () => ({
  prisma: { user: { findMany: vi.fn(), findUnique: vi.fn() } },
}));

import { prisma } from "@/lib/prisma";
import { firstNameOf, listPeople, isActiveUser } from "@/lib/chat/people";

const findMany = vi.mocked(prisma.user.findMany);
const findUnique = vi.mocked(prisma.user.findUnique);

describe("firstNameOf", () => {
  it("uses the first word of the name", () => {
    expect(firstNameOf({ name: "Wesley Vos", email: "w@x.com" })).toBe("Wesley");
  });
  it("falls back to the email local part", () => {
    expect(firstNameOf({ name: null, email: "arno.s@gmail.com" })).toBe("arno.s");
  });
  it("treats a blank name as missing", () => {
    expect(firstNameOf({ name: "  ", email: "d@g.com" })).toBe("d");
  });
});

describe("people", () => {
  beforeEach(() => {
    vi.stubEnv("ALLOWED_EMAILS", "a@x.com,b@x.com");
    vi.clearAllMocks();
  });
  afterEach(() => vi.unstubAllEnvs());

  it("lists only allowlisted users other than the caller, without emails", async () => {
    findMany.mockResolvedValue([
      { id: "u1", email: "a@x.com", name: "Ann Lee", image: null },
      { id: "u2", email: "b@x.com", name: "Bob Ray", image: "i.png" },
      { id: "u3", email: "c@x.com", name: "Cy", image: null },
    ] as never);
    const people = await listPeople("u1");
    expect(people).toEqual([{ id: "u2", firstName: "Bob", image: "i.png" }]);
    expect(Object.keys(people[0]).sort()).toEqual(["firstName", "id", "image"]);
  });

  it("sorts by first name", async () => {
    vi.stubEnv("ALLOWED_EMAILS", "a@x.com,b@x.com,c@x.com");
    findMany.mockResolvedValue([
      { id: "u2", email: "b@x.com", name: "Zed", image: null },
      { id: "u3", email: "c@x.com", name: "Amy", image: null },
    ] as never);
    expect((await listPeople("u1")).map((p) => p.firstName)).toEqual(["Amy", "Zed"]);
  });

  it("isActiveUser is false for an unknown id", async () => {
    findUnique.mockResolvedValue(null);
    expect(await isActiveUser("nope")).toBe(false);
  });
  it("isActiveUser is false for a non-allowlisted user", async () => {
    findUnique.mockResolvedValue({ email: "c@x.com" } as never);
    expect(await isActiveUser("u3")).toBe(false);
  });
  it("isActiveUser is true for an allowlisted user", async () => {
    findUnique.mockResolvedValue({ email: "a@x.com" } as never);
    expect(await isActiveUser("u1")).toBe(true);
  });
});
