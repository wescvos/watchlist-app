import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

import { SendButton } from "@/components/SendButton";

const people = [
  { id: "u1", firstName: "Anna", image: "https://example.com/a.jpg" },
  { id: "u2", firstName: "Bram", image: null },
  { id: "u3", firstName: "Cleo", image: null },
];

let fetchMock: ReturnType<typeof vi.fn>;

function mockFetch(peopleBody: unknown, sendRes?: { ok: boolean; status: number; body: unknown }) {
  fetchMock = vi.fn((url: string, init?: RequestInit) => {
    if (url === "/api/chat/people") {
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(peopleBody) });
    }
    const r = sendRes ?? { ok: true, status: 200, body: { conversationIds: ["c1"] } };
    void init;
    return Promise.resolve({ ok: r.ok, status: r.status, json: () => Promise.resolve(r.body) });
  });
  vi.stubGlobal("fetch", fetchMock);
}

beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

async function openSheet() {
  render(<SendButton tmdbId={603} mediaType="MOVIE" titleName="The Matrix" />);
  fireEvent.click(screen.getByRole("button", { name: "Send" }));
  await screen.findByText("Anna");
}

describe("SendButton", () => {
  it("opens, fetches people and lists them with photos or initials", async () => {
    mockFetch(people);
    await openSheet();
    expect(fetchMock).toHaveBeenCalledWith("/api/chat/people");
    expect(screen.getByRole("dialog")).toHaveAttribute("aria-modal", "true");
    expect(screen.getByText("Send to")).toBeInTheDocument();
    expect(screen.getByText("Bram")).toBeInTheDocument();
    expect(document.querySelector('img[src="https://example.com/a.jpg"]')).not.toBeNull();
    expect(screen.getByText("B")).toBeInTheDocument();
    // Nothing ticked yet: a plain, disabled Send.
    const submit = screen.getAllByRole("button", { name: "Send" }).find((b) => b.closest('[role="dialog"]'));
    expect(submit).toBeDisabled();
  });

  it("enables the submit button with the count of ticked people", async () => {
    mockFetch(people);
    await openSheet();
    fireEvent.click(screen.getByLabelText("Anna"));
    expect(screen.getByRole("button", { name: "Send to 1 person" })).toBeEnabled();
    fireEvent.click(screen.getByLabelText("Bram"));
    expect(screen.getByRole("button", { name: "Send to 2 people" })).toBeEnabled();
    fireEvent.click(screen.getByLabelText("Cleo"));
    expect(screen.getByRole("button", { name: "Send to 3 people" })).toBeEnabled();
  });

  it("sizes the trigger by prop, not by a className override", () => {
    const { rerender } = render(<SendButton tmdbId={1} mediaType="TV" titleName="X" />);
    const trigger = screen.getByRole("button", { name: "Send" });
    expect(trigger.className.split(" ")).toContain("py-2");
    expect(trigger.className.split(" ")).not.toContain("py-3");
    rerender(<SendButton tmdbId={1} mediaType="TV" titleName="X" size="lg" className="flex-1" />);
    expect(trigger.className.split(" ")).toContain("py-3");
    expect(trigger.className.split(" ")).not.toContain("py-2");
    expect(trigger.className.split(" ")).toContain("flex-1");
  });

  it("posts the payload, omits blank text, and closes with Sent", async () => {
    mockFetch(people);
    await openSheet();
    fireEvent.click(screen.getByLabelText("Anna"));
    fireEvent.click(screen.getByLabelText("Bram"));
    fireEvent.change(screen.getByPlaceholderText("Add a message (optional)"), { target: { value: "   " } });
    fireEvent.click(screen.getByRole("button", { name: "Send to 2 people" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const call = fetchMock.mock.calls.find((c) => c[0] === "/api/chat/send")!;
    expect(call[1].method).toBe("POST");
    expect(JSON.parse(call[1].body)).toEqual({ recipientIds: ["u1", "u2"], tmdbId: 603, mediaType: "MOVIE" });
    expect(screen.getByText("Sent")).toBeInTheDocument();
  });

  it("includes trimmed text when given", async () => {
    mockFetch(people);
    await openSheet();
    fireEvent.click(screen.getByLabelText("Cleo"));
    fireEvent.change(screen.getByPlaceholderText("Add a message (optional)"), { target: { value: " watch this " } });
    fireEvent.click(screen.getByRole("button", { name: "Send to 1 person" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    const call = fetchMock.mock.calls.find((c) => c[0] === "/api/chat/send")!;
    expect(JSON.parse(call[1].body)).toEqual({ recipientIds: ["u3"], tmdbId: 603, mediaType: "MOVIE", text: "watch this" });
  });

  it("shows the API error and keeps selections and text on failure", async () => {
    mockFetch(people, { ok: false, status: 400, body: { error: "Message too long" } });
    await openSheet();
    fireEvent.click(screen.getByLabelText("Anna"));
    fireEvent.change(screen.getByPlaceholderText("Add a message (optional)"), { target: { value: "hi" } });
    fireEvent.click(screen.getByRole("button", { name: "Send to 1 person" }));
    expect(await screen.findByText("Message too long")).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByLabelText("Anna")).toBeChecked();
    expect(screen.getByPlaceholderText("Add a message (optional)")).toHaveValue("hi");
  });

  it("shows the empty copy when nobody else is on the app", async () => {
    mockFetch([]);
    render(<SendButton tmdbId={1} mediaType="TV" titleName="X" />);
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Nobody else is on Watchlist yet.")).toBeInTheDocument();
  });

  it("closes on Escape and on backdrop tap", async () => {
    mockFetch(people);
    await openSheet();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Send" }));
    await screen.findByText("Anna");
    fireEvent.click(screen.getByTestId("send-backdrop"));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
