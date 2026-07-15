"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function GatePage() {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    try {
      const res = await fetch("/api/auth", { method: "POST", body: JSON.stringify({ passcode }) });
      if (res.ok) {
        router.push("/");
        return;
      }
      setError("Incorrect passcode");
    } catch {
      setError("Can't reach the server. Check your connection.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-xs space-y-4">
        <p className="text-center meta">Private library</p>
        <h1 className="text-xl font-semibold text-center">Watchlist</h1>
        <input
          type="password"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          placeholder="Passcode"
          aria-label="Passcode"
          autoComplete="current-password"
          className="w-full rounded-lg border border-black/10 bg-gray-50 p-3 focus-visible:border-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground dark:border-white/10 dark:bg-white/5"
          autoFocus
        />
        {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}
        <button
          disabled={busy}
          className="w-full rounded-lg bg-foreground p-3 font-medium text-background transition-opacity hover:opacity-90 active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:opacity-50"
        >
          {busy ? "Checking…" : "Enter"}
        </button>
      </form>
    </main>
  );
}
