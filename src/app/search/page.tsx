"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface Result { tmdbId: number; mediaType: "MOVIE" | "TV"; title: string; year: number | null; posterUrl: string | null; }

export default function Search() {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  const [adding, setAdding] = useState<number | null>(null);
  const [addError, setAddError] = useState("");
  const router = useRouter();

  async function run(e: React.FormEvent) {
    e.preventDefault();
    if (!q.trim()) return;
    setBusy(true);
    setAddError("");
    const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
    setResults(res.ok ? await res.json() : []);
    setBusy(false);
  }

  async function add(r: Result, status: "WANT" | "WATCHED") {
    setAdding(r.tmdbId);
    setAddError("");
    try {
      const res = await fetch("/api/titles", {
        method: "POST",
        body: JSON.stringify({ tmdbId: r.tmdbId, mediaType: r.mediaType, status }),
      });
      if (res.ok) {
        const t = await res.json();
        router.push(`/title/${t.id}`);
        return;
      }
      setAddError(`Couldn't add "${r.title}". Please try again.`);
    } catch {
      setAddError(`Couldn't add "${r.title}". Please try again.`);
    } finally {
      setAdding(null);
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-4">
      <div className="mb-4 flex items-center gap-3">
        <Link href="/" className="text-sm text-gray-500">← Back</Link>
        <h1 className="text-lg font-semibold">Search</h1>
      </div>
      <form onSubmit={run} className="mb-4 flex gap-2">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Movie or series…"
          className="flex-1 rounded-lg border p-3" autoFocus />
        <button className="rounded-lg bg-black px-4 text-white">Go</button>
      </form>
      {busy && <p className="text-center text-sm text-gray-500">Searching…</p>}
      {addError && <p className="mb-2 text-sm text-red-600">{addError}</p>}
      <ul className="space-y-2">
        {results.map((r) => (
          <li key={`${r.mediaType}-${r.tmdbId}`} className="flex items-center gap-3 rounded-lg border p-2">
            <div className="h-20 w-14 flex-shrink-0 overflow-hidden rounded bg-gray-200">
              {r.posterUrl && /* eslint-disable-next-line @next/next/no-img-element */
                <img src={r.posterUrl} alt={r.title} className="h-full w-full object-cover" />}
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate font-medium">{r.title}</p>
              <p className="text-xs text-gray-500">{r.mediaType === "TV" ? "TV" : "Movie"}{r.year ? ` · ${r.year}` : ""}</p>
            </div>
            <div className="flex flex-shrink-0 flex-col gap-1">
              <button onClick={() => add(r, "WANT")} disabled={adding === r.tmdbId}
                className="rounded-lg bg-black px-3 py-1.5 text-xs text-white disabled:opacity-50">
                + Want
              </button>
              <button onClick={() => add(r, "WATCHED")} disabled={adding === r.tmdbId}
                className="rounded-lg border px-3 py-1.5 text-xs disabled:opacity-50">
                + Watched
              </button>
            </div>
          </li>
        ))}
      </ul>
    </main>
  );
}
