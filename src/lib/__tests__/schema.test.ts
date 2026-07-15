import { describe, it, expect } from "vitest";
import { MediaType, Status } from "@prisma/client";

describe("prisma enums", () => {
  it("exposes MediaType and Status", () => {
    expect(MediaType.MOVIE).toBe("MOVIE");
    expect(Status.WATCHED).toBe("WATCHED");
  });
});
