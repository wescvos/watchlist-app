"use client";
import { useEffect, useRef, useState } from "react";
import { Avatar } from "@/components/Avatar";

interface Person {
  id: string;
  firstName: string;
  image: string | null;
}

interface Props {
  tmdbId: number;
  mediaType: "MOVIE" | "TV";
  titleName: string;
  /** Extra classes for the trigger button (for example "flex-1" in a button row). */
  className?: string;
}

const OUTLINE_BUTTON =
  "rounded-lg border border-black/12 px-3 py-2 text-sm font-medium transition-colors hover:bg-gray-100 active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground disabled:opacity-50 dark:border-white/15 dark:hover:bg-white/10 dark:active:bg-white/10";

export function SendButton({ tmdbId, mediaType, titleName, className = "" }: Props) {
  const [open, setOpen] = useState(false);
  const [people, setPeople] = useState<Person[] | null>(null);
  const [loadError, setLoadError] = useState("");
  const [selected, setSelected] = useState<string[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const sentTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (sentTimeout.current) clearTimeout(sentTimeout.current);
    };
  }, []);

  function close() {
    setOpen(false);
    triggerRef.current?.focus();
  }

  // Load people each time the sheet opens so newly joined users appear.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    fetch("/api/chat/people")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("bad response"))))
      .then((data: Person[]) => {
        if (!cancelled) setPeople(data);
      })
      .catch(() => {
        if (!cancelled) setLoadError("Couldn't load people. Please try again.");
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    panelRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open]);

  function toggle(id: string) {
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  }

  async function submit() {
    if (selected.length === 0 || sending) return;
    setSending(true);
    setError("");
    const trimmed = text.trim();
    const body: Record<string, unknown> = { recipientIds: selected, tmdbId, mediaType };
    if (trimmed) body.text = trimmed;
    try {
      const res = await fetch("/api/chat/send", { method: "POST", body: JSON.stringify(body) });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? "Couldn't send. Please try again.");
        return;
      }
      setSelected([]);
      setText("");
      close();
      setSent(true);
      if (sentTimeout.current) clearTimeout(sentTimeout.current);
      sentTimeout.current = setTimeout(() => setSent(false), 2000);
    } catch {
      setError("Couldn't send. Please try again.");
    } finally {
      setSending(false);
    }
  }

  const count = selected.length;
  const submitLabel = count === 2 || count > 2 ? `Send to ${count} people` : "Send to 1 person";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          setLoadError("");
          setOpen(true);
        }}
        aria-haspopup="dialog"
        className={`${OUTLINE_BUTTON} ${className}`}
      >
        Send
      </button>
      {sent && (
        <span role="status" className="meta flash-caption">
          Sent
        </span>
      )}
      {open && (
        <div className="fixed inset-0 z-50 flex items-end">
          <div data-testid="send-backdrop" className="absolute inset-0 bg-black/50" onClick={close} />
          <div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="send-sheet-heading"
            tabIndex={-1}
            style={{ paddingBottom: "calc(env(safe-area-inset-bottom) + 1rem)" }}
            className="relative mx-auto flex max-h-[85dvh] w-full max-w-2xl flex-col rounded-t-2xl bg-background p-4 shadow-xl focus:outline-none"
          >
            <h2 id="send-sheet-heading" className="text-base font-semibold">
              Send to
            </h2>
            <p className="meta mt-0.5 truncate">{titleName}</p>

            <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
              {loadError ? (
                <p className="text-sm text-red-600 dark:text-red-400">{loadError}</p>
              ) : people === null ? (
                <p className="text-sm text-gray-500">Loading…</p>
              ) : people.length === 0 ? (
                <p className="text-sm text-gray-500">Nobody else is on Watchlist yet.</p>
              ) : (
                <ul>
                  {people.map((p) => (
                    <li key={p.id}>
                      <label className="flex cursor-pointer items-center gap-3 rounded-lg px-1 py-2 hover:bg-gray-100 dark:hover:bg-white/10">
                        <Avatar person={p} />
                        <span className="flex-1 text-sm">{p.firstName}</span>
                        <input
                          type="checkbox"
                          aria-label={p.firstName}
                          checked={selected.includes(p.id)}
                          onChange={() => toggle(p.id)}
                          className="h-5 w-5 accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground"
                        />
                      </label>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {people && people.length > 0 && (
              <>
                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  rows={2}
                  maxLength={2000}
                  placeholder="Add a message (optional)"
                  className="mt-3 w-full rounded-lg border border-black/10 bg-gray-50 p-2 text-base focus-visible:border-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground sm:text-sm dark:border-white/10 dark:bg-white/5"
                />
                {error && <p className="mt-2 text-sm text-red-600 dark:text-red-400">{error}</p>}
                <button
                  type="button"
                  onClick={submit}
                  disabled={count === 0 || sending}
                  className="mt-3 w-full rounded-lg bg-foreground px-3 py-3 text-sm font-medium text-background transition-opacity hover:opacity-90 active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
                >
                  {submitLabel}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
