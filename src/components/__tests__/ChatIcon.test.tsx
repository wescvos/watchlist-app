import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import { ChatIcon } from "@/components/ChatIcon";

function stub(impl: () => Promise<unknown>) {
  vi.stubGlobal("fetch", vi.fn(impl));
}
const ok = (count: number) => async () => ({ ok: true, json: async () => ({ count }) });

afterEach(() => vi.unstubAllGlobals());

async function settle() {
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

describe("ChatIcon", () => {
  it("links to /chats with no badge when nothing is unread", async () => {
    stub(ok(0));
    render(<ChatIcon />);
    await settle();
    const link = screen.getByRole("link", { name: "Chats" });
    expect(link).toHaveAttribute("href", "/chats");
    expect(link.querySelector("[data-badge]")).toBeNull();
  });

  it("shows the unread count and labels it", async () => {
    stub(ok(2));
    render(<ChatIcon />);
    await settle();
    const link = screen.getByRole("link", { name: "Chats, 2 unread" });
    expect(link).toHaveTextContent("2");
  });

  it("caps the badge at 9+", async () => {
    stub(ok(14));
    render(<ChatIcon />);
    await settle();
    expect(screen.getByRole("link", { name: "Chats, 14 unread" })).toHaveTextContent("9+");
  });

  it("keeps the icon without a badge when the fetch fails", async () => {
    stub(async () => { throw new Error("offline"); });
    render(<ChatIcon />);
    await settle();
    expect(screen.getByRole("link", { name: "Chats" }).querySelector("[data-badge]")).toBeNull();
  });

  it("keeps the icon without a badge on a non-ok response", async () => {
    stub(async () => ({ ok: false, json: async () => ({}) }));
    render(<ChatIcon />);
    await settle();
    expect(screen.getByRole("link", { name: "Chats" }).querySelector("[data-badge]")).toBeNull();
  });
});
