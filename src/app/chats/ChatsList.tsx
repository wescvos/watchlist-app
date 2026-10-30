"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BackLink } from "@/components/BackLink";
import { Avatar } from "@/components/Avatar";
import { usePolling } from "@/lib/usePolling";
import { formatRelative } from "@/lib/chat/time";

interface Person {
  id: string;
  firstName: string;
  image: string | null;
}

interface Conversation {
  id: string;
  other: Person;
  otherActive: boolean;
  lastMessageAt: string;
  preview: string;
  unread: boolean;
}

const ROW =
  "flex w-full items-center gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-gray-100 active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground disabled:opacity-50 dark:hover:bg-white/10 dark:active:bg-white/10";

export function ChatsList() {
  const router = useRouter();
  const [conversations, setConversations] = useState<Conversation[] | null>(null);
  const [people, setPeople] = useState<Person[]>([]);
  const [error, setError] = useState(false);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/chat/conversations");
      if (!res.ok) throw new Error("bad response");
      setConversations((await res.json()) as Conversation[]);
      setError(false);
    } catch {
      // Keep showing the last good list on a failed poll; only surface the
      // error when there is nothing to show yet.
      setError(true);
    }
  }, []);

  // People change rarely, so they load on mount and after starting a chat
  // rather than on every poll. A failure just leaves "Start a new chat" empty;
  // the chats still show.
  const [peopleKey, setPeopleKey] = useState(0);
  useEffect(() => {
    let cancelled = false;
    fetch("/api/chat/people")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("bad response"))))
      .then((data: Person[]) => {
        if (!cancelled) setPeople(data);
      })
      .catch(() => {
        if (!cancelled) setPeople([]);
      });
    return () => {
      cancelled = true;
    };
  }, [peopleKey]);

  usePolling(load, 10000);

  async function start(otherUserId: string) {
    if (starting) return;
    setStarting(true);
    setStartError("");
    try {
      const res = await fetch("/api/chat/conversations", {
        method: "POST",
        body: JSON.stringify({ otherUserId }),
      });
      if (!res.ok) throw new Error("bad response");
      const { id } = (await res.json()) as { id: string };
      setPeopleKey((k) => k + 1);
      router.push(`/chats/${id}`);
    } catch {
      setStartError("Couldn't start the chat. Please try again.");
      setStarting(false);
    }
  }

  const existing = new Set((conversations ?? []).map((c) => c.other.id));
  const newPeople = people.filter((p) => !existing.has(p.id));
  const now = new Date();

  return (
    <main className="mx-auto w-full max-w-2xl p-4 pb-24">
      <div className="mb-4 flex items-center gap-2">
        <BackLink href="/" label="Back to watchlist" />
        <h1 className="text-lg font-semibold tracking-tight">Chats</h1>
      </div>

      {conversations === null && error ? (
        <div role="alert" className="text-sm text-red-600 dark:text-red-400">
          <p>Couldn&apos;t load your chats.</p>
          <button
            type="button"
            onClick={() => void load()}
            className="mt-2 rounded-lg border border-black/12 px-3 py-2 font-medium text-foreground hover:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground dark:border-white/15 dark:hover:bg-white/10"
          >
            Retry
          </button>
        </div>
      ) : conversations === null ? (
        <ul aria-busy="true" aria-label="Loading chats">
          {[0, 1, 2].map((i) => (
            <li key={i} className="flex items-center gap-3 px-2 py-2.5">
              <span className="h-9 w-9 shrink-0 rounded-full bg-gray-200 dark:bg-white/15" />
              <span className="h-4 flex-1 rounded bg-gray-100 dark:bg-white/10" />
            </li>
          ))}
        </ul>
      ) : (
        <>
          {conversations.length === 0 ? (
            <p className="text-sm text-gray-500">No chats yet. Send someone a movie from any title page.</p>
          ) : (
            <ul>
              {conversations.map((c) => (
                <li key={c.id}>
                  <Link href={`/chats/${c.id}`} className={ROW}>
                    <Avatar person={c.other} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">{c.other.firstName}</span>
                      <span className="meta block truncate">{c.preview}</span>
                    </span>
                    <span className="meta shrink-0">{formatRelative(c.lastMessageAt, now)}</span>
                    {c.unread && (
                      <span
                        data-testid="unread-dot"
                        role="img"
                        aria-label="Unread"
                        className="h-2.5 w-2.5 shrink-0 rounded-full bg-blue-500"
                      />
                    )}
                  </Link>
                </li>
              ))}
            </ul>
          )}

          {newPeople.length > 0 && (
            <section className="mt-6">
              <h2 className="meta mb-1 px-2">Start a new chat</h2>
              <ul>
                {newPeople.map((p) => (
                  <li key={p.id}>
                    <button type="button" onClick={() => void start(p.id)} disabled={starting} className={ROW}>
                      <Avatar person={p} />
                      <span className="flex-1 text-sm">{p.firstName}</span>
                    </button>
                  </li>
                ))}
              </ul>
              {startError && <p className="mt-2 px-2 text-sm text-red-600 dark:text-red-400">{startError}</p>}
            </section>
          )}
        </>
      )}
    </main>
  );
}
