import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/auth", () => ({ signIn: vi.fn() }));

import SignInPage from "../page";

async function renderPage(error?: string) {
  render(await SignInPage({ searchParams: Promise.resolve({ error }) }));
}

describe("SignInPage", () => {
  it("shows the invite message for AccessDenied", async () => {
    await renderPage("AccessDenied");
    expect(screen.getByRole("alert").textContent).toContain("not on the invite list");
  });

  it("shows the generic message with the code for any other error", async () => {
    await renderPage("Configuration");
    expect(screen.getByRole("alert").textContent).toBe(
      "Sign-in didn't complete (code: Configuration). Try again, or open the app in Safari and sign in there.",
    );
  });

  it("shows no message without an error", async () => {
    await renderPage(undefined);
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
