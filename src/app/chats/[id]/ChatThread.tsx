"use client";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type MouseEvent } from "react";
import { useRouter } from "next/navigation";
import { BackLink } from "@/components/BackLink";
import { Avatar } from "@/components/Avatar";
import { ChatTitleCard, chatTitleHref } from "@/components/ChatTitleCard";
import { usePolling } from "@/lib/usePolling";
import type { ChatMessage, ChatPage } from "@/lib/chat/messages";
import type { Person } from "@/lib/chat/people";

interface Props {
  conversationId: string;
  meId: string;
  other: Person;
  otherActive: boolean;
  initialPage: ChatPage;
}

interface Pending {
  tempId: string;
  text: string;
}

const DOUBLE_TAP_MS = 300;
const NEAR_BOTTOM_PX = 120;
const MAX_INPUT_PX = 120; // about 5 lines of text-base

function byTime(a: ChatMessage, b: ChatMessage) {
  return a.createdAt === b.createdAt ? (a.id < b.id ? -1 : 1) : a.createdAt < b.createdAt ? -1 : 1;
}

/**
 * Merge by id: incoming messages replace what is held for their ids (so heart
 * and list-status changes, removals included, land) and new ids are added.
 * Anything held but not in `incoming` (older pages from "Load earlier") stays.
 */
export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return [...byId.values()].sort(byTime);
}

function HeartIcon({ className }: { className: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path d="M12 21s-7.5-4.6-9.5-9.2C1 8.3 3.2 5 6.6 5c2 0 3.4 1.1 4.4 2.5C12 6.1 13.4 5 15.4 5 18.8 5 21 8.3 19.5 11.8 17.5 16.4 12 21 12 21z" />
    </svg>
  );
}

function canEnterSend() {
  // Enter sends only with a real keyboard and mouse; on touch screens Enter
  // is a newline and the Send button sends.
  return typeof window.matchMedia === "function" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

export function ChatThread({ conversationId, meId, other, otherActive, initialPage }: Props) {
  const router = useRouter();
  const base = `/api/chat/conversations/${conversationId}`;
  const [messages, setMessages] = useState<ChatMessage[]>(initialPage.messages);
  const [hasEarlier, setHasEarlier] = useState(initialPage.hasEarlier);
  const [otherLastReadAt, setOtherLastReadAt] = useState(initialPage.otherLastReadAt);
  const [loadingEarlier, setLoadingEarlier] = useState(false);
  const [earlierError, setEarlierError] = useState("");
  const [pending, setPending] = useState<Pending[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  // Starts true so the first layout pass jumps to the bottom.
  const nearBottom = useRef(true);
  // Set just before "Load earlier" lands so the next layout pass keeps the
  // viewport on the same message instead of jumping.
  const anchor = useRef<{ height: number; top: number } | null>(null);
  const knownIds = useRef(new Set(initialPage.messages.map((m) => m.id)));
  const lastTap = useRef<{ id: string; at: number } | null>(null);
  const tapTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const tempSeq = useRef(0);

  const markRead = useCallback(() => {
    fetch(`${base}/read`, { method: "POST" }).catch(() => {});
  }, [base]);

  useEffect(() => {
    markRead();
  }, [markRead]);

  useEffect(() => {
    return () => {
      if (tapTimer.current) clearTimeout(tapTimer.current);
    };
  }, []);

  function absorb(incoming: ChatMessage[]) {
    const fresh = incoming.filter((m) => !knownIds.current.has(m.id));
    for (const m of incoming) knownIds.current.add(m.id);
    setMessages((cur) => mergeMessages(cur, incoming));
    return fresh;
  }

  usePolling(async () => {
    const res = await fetch(`${base}/messages`);
    if (!res.ok) return;
    const data = (await res.json()) as ChatPage;
    // hasEarlier is deliberately not taken from polls: it describes the newest
    // window, while the thread may already hold older pages.
    setOtherLastReadAt(data.otherLastReadAt);
    const fresh = absorb(data.messages);
    if (fresh.some((m) => m.senderId !== meId) && document.visibilityState === "visible") markRead();
  }, 3000);

  async function loadEarlier() {
    const oldest = messages[0];
    if (!oldest || loadingEarlier) return;
    setLoadingEarlier(true);
    setEarlierError("");
    try {
      const res = await fetch(`${base}/messages?before=${encodeURIComponent(oldest.id)}`);
      if (!res.ok) throw new Error("bad response");
      const data = (await res.json()) as ChatPage;
      const el = scrollRef.current;
      if (el) anchor.current = { height: el.scrollHeight, top: el.scrollTop };
      absorb(data.messages);
      setHasEarlier(data.hasEarlier);
    } catch {
      setEarlierError("Couldn't load earlier messages.");
    } finally {
      setLoadingEarlier(false);
    }
  }

  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    if (anchor.current) {
      el.scrollTop = el.scrollHeight - anchor.current.height + anchor.current.top;
      anchor.current = null;
    } else if (nearBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, [messages, pending, otherLastReadAt]);

  function onScroll() {
    const el = scrollRef.current;
    if (!el) return;
    nearBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  }

  async function toggleHeart(id: string) {
    const flip = (m: ChatMessage, on: boolean) =>
      m.id !== id
        ? m
        : { ...m, heartedBy: on ? [...m.heartedBy.filter((u) => u !== meId), meId] : m.heartedBy.filter((u) => u !== meId) };
    const target = messages.find((m) => m.id === id);
    if (!target) return;
    const wasHearted = target.heartedBy.includes(meId);
    setMessages((cur) => cur.map((m) => flip(m, !wasHearted)));
    try {
      const res = await fetch(`/api/chat/messages/${id}/heart`, { method: "POST" });
      if (!res.ok) throw new Error("bad response");
      const { hearted } = (await res.json()) as { hearted: boolean };
      setMessages((cur) => cur.map((m) => flip(m, hearted)));
    } catch {
      setMessages((cur) => cur.map((m) => flip(m, wasHearted)));
    }
  }

  /**
   * Pointer taps only (keyboard activation has detail 0 and keeps its default).
   * A second tap on the same message within DOUBLE_TAP_MS hearts it; a lone
   * tap runs `single` once the double-tap window has passed.
   */
  function onTap(e: MouseEvent, id: string, single?: () => void) {
    if (e.detail === 0) return;
    if (single) e.preventDefault();
    const now = e.timeStamp;
    const prev = lastTap.current;
    if (tapTimer.current) {
      clearTimeout(tapTimer.current);
      tapTimer.current = null;
    }
    if (prev && prev.id === id && now - prev.at < DOUBLE_TAP_MS) {
      lastTap.current = null;
      void toggleHeart(id);
      return;
    }
    lastTap.current = { id, at: now };
    if (single) {
      tapTimer.current = setTimeout(() => {
        tapTimer.current = null;
        single();
      }, DOUBLE_TAP_MS);
    }
  }

  // Grow with the text up to about 5 lines, then scroll inside the box.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, MAX_INPUT_PX)}px`;
  }, [text]);

  async function send() {
    const body = text.trim();
    if (!body || sending) return;
    const tempId = `pending-${++tempSeq.current}`;
    const original = text;
    setSending(true);
    setError("");
    setText("");
    nearBottom.current = true;
    setPending((p) => [...p, { tempId, text: body }]);
    let failure = "Couldn't send. Please try again.";
    try {
      const res = await fetch(`${base}/messages`, { method: "POST", body: JSON.stringify({ text: body }) });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        if (data?.error) failure = data.error;
        throw new Error("send failed");
      }
      absorb([(await res.json()) as ChatMessage]);
    } catch {
      // Only restore when the box is still empty, so text typed meanwhile is kept.
      setText((cur) => (cur ? cur : original));
      setError(failure);
    } finally {
      setPending((p) => p.filter((x) => x.tempId !== tempId));
      setSending(false);
    }
  }

  const myLatest = [...messages].reverse().find((m) => m.senderId === meId);
  const seenId =
    myLatest && otherLastReadAt && new Date(otherLastReadAt).getTime() >= new Date(myLatest.createdAt).getTime()
      ? myLatest.id
      : null;

  return (
    <main
      className="mx-auto flex w-full max-w-2xl flex-col"
      style={{ height: "calc(100dvh - env(safe-area-inset-top) - env(safe-area-inset-bottom))" }}
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-black/10 px-4 py-2 dark:border-white/10">
        <BackLink href="/chats" label="Back to chats" />
        <Avatar person={other} />
        <h1 className="truncate text-base font-semibold tracking-tight">{other.firstName}</h1>
      </header>

      <div ref={scrollRef} onScroll={onScroll} className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {hasEarlier && (
          <div className="mb-3 flex flex-col items-center">
            <button
              type="button"
              onClick={() => void loadEarlier()}
              disabled={loadingEarlier}
              className="rounded-full border border-black/12 px-3 py-1.5 text-xs font-medium transition-colors hover:bg-gray-100 active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground disabled:opacity-50 dark:border-white/15 dark:hover:bg-white/10 dark:active:bg-white/10"
            >
              Load earlier
            </button>
            {earlierError && <p className="mt-1 text-xs text-red-600 dark:text-red-400">{earlierError}</p>}
          </div>
        )}

        <ul className="flex flex-col gap-1.5">
          {messages.map((m) => {
            const mine = m.senderId === meId;
            const hearted = m.heartedBy.includes(meId);
            return (
              <li
                key={m.id}
                data-message-id={m.id}
                className={`group flex flex-col ${mine ? "items-end" : "items-start"}`}
              >
                {m.title ? (
                  <ChatTitleCard
                    title={m.title}
                    senderRating={m.senderRating}
                    viewerStatus={m.viewerStatus}
                    raterName={mine ? "You" : other.firstName}
                    onClick={(e) => {
                      const href = chatTitleHref(m.title!, m.viewerStatus);
                      onTap(e, m.id, () => router.push(href));
                    }}
                  />
                ) : (
                  <p
                    onClick={(e) => onTap(e, m.id)}
                    className={`max-w-[78%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-[15px] leading-snug [touch-action:manipulation] ${
                      mine ? "bg-blue-500 text-white" : "bg-gray-200 text-foreground dark:bg-white/15"
                    }`}
                  >
                    {m.text}
                  </p>
                )}
                {m.heartedBy.length > 0 && (
                  <span role="img" aria-label="Hearted" className="-mt-1 px-2">
                    <HeartIcon className="h-4 w-4 text-red-500 drop-shadow-sm" />
                  </span>
                )}
                {/* Keyboard path to hearting, so it is never gesture-only. */}
                <button
                  type="button"
                  onClick={() => void toggleHeart(m.id)}
                  className="sr-only rounded px-2 text-xs focus-visible:not-sr-only focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
                >
                  {hearted ? "Remove heart" : "Heart message"}
                </button>
                {m.id === seenId && <span className="meta mt-0.5 px-1">Seen</span>}
              </li>
            );
          })}
          {pending.map((p) => (
            <li key={p.tempId} className="flex flex-col items-end">
              <p className="max-w-[78%] whitespace-pre-wrap break-words rounded-2xl bg-blue-500 px-3 py-2 text-[15px] leading-snug text-white opacity-60">
                {p.text}
              </p>
            </li>
          ))}
        </ul>
      </div>

      {otherActive ? (
        <div className="shrink-0 border-t border-black/10 px-4 py-2 dark:border-white/10">
          {error && (
            <p role="alert" className="mb-1.5 text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          )}
          <div className="flex items-end gap-2">
            <textarea
              ref={inputRef}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing && canEnterSend()) {
                  e.preventDefault();
                  void send();
                }
              }}
              rows={1}
              maxLength={2000}
              placeholder="Message"
              aria-label={`Message ${other.firstName}`}
              className="min-h-10 flex-1 resize-none rounded-2xl border border-black/10 bg-gray-50 px-3 py-2 text-base leading-6 focus-visible:border-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground dark:border-white/10 dark:bg-white/5"
            />
            <button
              type="button"
              // Keeps focus (and the iOS keyboard) on the textarea when tapping Send.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => void send()}
              disabled={!text.trim() || sending}
              className="h-10 shrink-0 rounded-full bg-blue-500 px-4 text-sm font-medium text-white transition-opacity hover:opacity-90 active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-40"
            >
              Send
            </button>
          </div>
        </div>
      ) : (
        <p className="shrink-0 border-t border-black/10 px-4 py-3 text-center text-sm text-gray-500 dark:border-white/10">
          This person is no longer on Watchlist.
        </p>
      )}
    </main>
  );
}
