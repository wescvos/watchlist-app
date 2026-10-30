"use client";
import { useState } from "react";
import Link from "next/link";
import { usePolling } from "@/lib/usePolling";

const UNREAD_POLL_MS = 30000;

export function ChatIcon() {
  const [count, setCount] = useState(0);

  // usePolling only runs after mount, so the static prerender and the first
  // client render are identical (icon, no badge) and nothing shifts.
  usePolling(async () => {
    try {
      const res = await fetch("/api/chat/unread");
      if (!res.ok) return;
      const data = (await res.json()) as { count?: unknown };
      // Anything but a number means no badge rather than a broken one.
      setCount(typeof data.count === "number" ? data.count : 0);
    } catch {
      // Keep the icon as it is; a badge is a nicety, never worth an error.
    }
  }, UNREAD_POLL_MS);

  return (
    <Link
      href="/chats"
      aria-label={count > 0 ? `Chats, ${count} unread` : "Chats"}
      // Fixed 36px square from the first render; the badge is absolute so it
      // never changes the box.
      className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-foreground active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground dark:hover:bg-white/10 dark:active:bg-white/10"
    >
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1.1-4.6A8 8 0 1 1 21 12z" />
      </svg>
      {count > 0 && (
        <span
          data-badge
          aria-hidden="true"
          className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-semibold leading-none text-white"
        >
          {count > 9 ? "9+" : count}
        </span>
      )}
    </Link>
  );
}
