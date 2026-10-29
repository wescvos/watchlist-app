import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const { order, sessionMock, signOutMock, clearMock } = vi.hoisted(() => {
  const order: string[] = [];
  return {
    order,
    sessionMock: vi.fn(),
    signOutMock: vi.fn(() => {
      order.push("signOut");
      return Promise.resolve();
    }),
    clearMock: vi.fn(() => {
      order.push("clear");
    }),
  };
});

vi.mock("next-auth/react", () => ({
  useSession: () => sessionMock(),
  signOut: signOutMock,
}));
vi.mock("@/lib/listPersist", () => ({ clearAllPersistedLists: clearMock }));

import { AccountMenu } from "@/components/AccountMenu";

beforeEach(() => {
  vi.clearAllMocks();
  order.length = 0;
  document.cookie = "wl_uid=u1; path=/";
});

describe("AccountMenu", () => {
  it("shows the first name from the session", () => {
    sessionMock.mockReturnValue({
      data: { user: { name: "Wesley Vos", email: "w@x.co" } },
      status: "authenticated",
    });
    render(<AccountMenu />);
    expect(screen.getByText("Wesley")).toBeInTheDocument();
    expect(screen.queryByText("Wesley Vos")).not.toBeInTheDocument();
  });

  it("falls back to the email local part when there is no name", () => {
    sessionMock.mockReturnValue({
      data: { user: { name: null, email: "jane.doe@x.co" } },
      status: "authenticated",
    });
    render(<AccountMenu />);
    expect(screen.getByText("jane.doe")).toBeInTheDocument();
  });

  it("renders nothing while the session loads", () => {
    sessionMock.mockReturnValue({ data: null, status: "loading" });
    const { container } = render(<AccountMenu />);
    expect(screen.queryByRole("button", { name: "Sign out" })).not.toBeInTheDocument();
    expect(container.textContent).toBe("");
  });

  it("clears every cached list, expires the cookie, then signs out to /signin", () => {
    sessionMock.mockReturnValue({
      data: { user: { name: "Wesley Vos", email: "w@x.co" } },
      status: "authenticated",
    });
    render(<AccountMenu />);

    fireEvent.click(screen.getByRole("button", { name: "Sign out" }));

    expect(order).toEqual(["clear", "signOut"]);
    expect(signOutMock).toHaveBeenCalledWith({ redirectTo: "/signin" });
    expect(document.cookie).not.toContain("wl_uid=u1");
  });
});
