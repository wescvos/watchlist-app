import { describe, it, expect, vi, beforeEach, type Mock } from "vitest";

vi.mock("@/lib/currentUser", () => ({ requireUserId: vi.fn() }));
vi.mock("@/lib/chat/conversations", () => ({ getConversationForUser: vi.fn() }));
vi.mock("@/lib/chat/messages", () => ({ getMessages: vi.fn() }));
vi.mock("@/app/chats/[id]/ChatThread", () => ({ ChatThread: () => null }));
// Like the real one, this throws so the page stops at the call.
const { notFoundSpy } = vi.hoisted(() => ({
  notFoundSpy: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
}));
vi.mock("next/navigation", () => ({ notFound: notFoundSpy }));

import { requireUserId } from "@/lib/currentUser";
import { getConversationForUser } from "@/lib/chat/conversations";
import { getMessages } from "@/lib/chat/messages";
import ChatThreadPage from "@/app/chats/[id]/page";

const mock = (fn: unknown) => fn as Mock;
const params = Promise.resolve({ id: "c1" });

beforeEach(() => {
  vi.clearAllMocks();
  mock(requireUserId).mockResolvedValue("u1");
});

describe("/chats/[id]", () => {
  it("is a 404 for a non-member, after the auth check and before reading messages", async () => {
    mock(getConversationForUser).mockResolvedValue(null);

    await expect(ChatThreadPage({ params })).rejects.toThrow("NOT_FOUND");

    expect(getConversationForUser).toHaveBeenCalledWith("u1", "c1");
    expect(mock(requireUserId).mock.invocationCallOrder[0]).toBeLessThan(
      mock(getConversationForUser).mock.invocationCallOrder[0],
    );
    expect(getMessages).not.toHaveBeenCalled();
  });

  it("reads nothing when the auth check fails", async () => {
    mock(requireUserId).mockRejectedValue(new Error("REDIRECT:/login"));

    await expect(ChatThreadPage({ params })).rejects.toThrow("REDIRECT:/login");

    expect(getConversationForUser).not.toHaveBeenCalled();
    expect(getMessages).not.toHaveBeenCalled();
  });

  it("renders the thread for a member", async () => {
    mock(getConversationForUser).mockResolvedValue({
      id: "c1",
      other: { id: "u2", firstName: "Anna", image: null },
      otherActive: true,
      myLastReadAt: null,
      otherLastReadAt: null,
    });
    mock(getMessages).mockResolvedValue({ messages: [], hasEarlier: false, otherLastReadAt: null });

    const el = await ChatThreadPage({ params });

    expect(notFoundSpy).not.toHaveBeenCalled();
    expect(getMessages).toHaveBeenCalledWith("u1", "c1");
    expect(el.props).toMatchObject({ conversationId: "c1", meId: "u1" });
  });
});
