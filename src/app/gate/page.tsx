"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function GatePage() {
  const [passcode, setPasscode] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const res = await fetch("/api/auth", { method: "POST", body: JSON.stringify({ passcode }) });
    if (res.ok) router.push("/");
    else setError("Incorrect passcode");
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <form onSubmit={submit} className="w-full max-w-xs space-y-4">
        <h1 className="text-xl font-semibold text-center">Watchlist</h1>
        <input
          type="password"
          value={passcode}
          onChange={(e) => setPasscode(e.target.value)}
          placeholder="Passcode"
          className="w-full rounded-lg border p-3"
          autoFocus
        />
        {error && <p className="text-sm text-red-600">{error}</p>}
        <button className="w-full rounded-lg bg-black text-white p-3">Enter</button>
      </form>
    </main>
  );
}
