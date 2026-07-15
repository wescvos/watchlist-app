"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface CastMember { name: string; character: string; }
interface Title {
  id: string; title: string; year: number | null; posterUrl: string | null;
  overview: string | null; runtime: number | null; genres: string[];
  cast: CastMember[]; director: string | null;
  tmdbScore: number | null; imdbScore: string | null; rtScore: string | null; metacriticScore: string | null;
  status: "WANT" | "WATCHED"; note: string | null; myRating: number | null;
}

function Rating({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div className="rounded-lg bg-gray-100 px-3 py-2 text-center">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="font-semibold">{value ?? "N/A"}</div>
    </div>
  );
}

export function TitleDetail({ title }: { title: Title }) {
  const router = useRouter();
  const [status, setStatus] = useState(title.status);
  const [note, setNote] = useState(title.note ?? "");
  const [myRating, setMyRating] = useState<number | "">(title.myRating ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  async function patch(body: Record<string, unknown>): Promise<boolean> {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/titles/${title.id}`, { method: "PATCH", body: JSON.stringify(body) });
      if (!res.ok) {
        setError("Couldn't save. Please try again.");
        return false;
      }
      router.refresh();
      return true;
    } catch {
      setError("Couldn't save. Please try again.");
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus() {
    const prev = status;
    const next = status === "WANT" ? "WATCHED" : "WANT";
    setStatus(next);
    const ok = await patch({ status: next });
    if (!ok) setStatus(prev);
  }

  async function refresh() {
    setSaving(true);
    setError("");
    try {
      const res = await fetch(`/api/titles/${title.id}/refresh`, { method: "POST" });
      if (!res.ok) {
        setError("Refresh failed. Please try again.");
        return;
      }
      router.refresh();
    } catch {
      setError("Refresh failed. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!confirm("Remove this title?")) return;
    setError("");
    try {
      const res = await fetch(`/api/titles/${title.id}`, { method: "DELETE" });
      if (!res.ok) {
        setError("Couldn't remove. Please try again.");
        return;
      }
      router.push("/");
    } catch {
      setError("Couldn't remove. Please try again.");
    }
  }

  return (
    <main className="mx-auto max-w-2xl p-4 pb-24">
      <Link href="/" className="text-sm text-gray-500">← Back</Link>

      <div className="mt-3 flex gap-4">
        <div className="h-48 w-32 flex-shrink-0 overflow-hidden rounded-lg bg-gray-200">
          {title.posterUrl && /* eslint-disable-next-line @next/next/no-img-element */
            <img src={title.posterUrl} alt={title.title} className="h-full w-full object-cover" />}
        </div>
        <div>
          <h1 className="text-xl font-semibold">{title.title}</h1>
          <p className="text-sm text-gray-500">
            {title.year ?? ""}{title.runtime ? ` · ${title.runtime} min` : ""}
          </p>
          {title.director && <p className="mt-1 text-sm">Director: {title.director}</p>}
          <div className="mt-2 flex flex-wrap gap-1">
            {title.genres.map((g) => (
              <span key={g} className="rounded-full bg-gray-100 px-2 py-0.5 text-xs">{g}</span>
            ))}
          </div>
        </div>
      </div>

      {/* My rating — the key personal field */}
      <div className="mt-4 rounded-xl border p-3">
        <label className="text-sm font-medium">My rating (0–10)</label>
        <div className="mt-2 flex items-center gap-2">
          <input
            type="number" min={0} max={10} value={myRating}
            onChange={(e) => setMyRating(e.target.value === "" ? "" : Number(e.target.value))}
            className="w-20 rounded-lg border p-2"
          />
          <button
            onClick={() => patch({ myRating: myRating === "" ? null : myRating })}
            className="rounded-lg bg-black px-3 py-2 text-sm text-white" disabled={saving}
          >Save</button>
        </div>
      </div>

      {/* External ratings */}
      <div className="mt-4 grid grid-cols-4 gap-2">
        <Rating label="TMDb" value={title.tmdbScore} />
        <Rating label="IMDb" value={title.imdbScore} />
        <Rating label="RT" value={title.rtScore} />
        <Rating label="Meta" value={title.metacriticScore} />
      </div>

      {title.overview && <p className="mt-4 text-sm leading-relaxed">{title.overview}</p>}

      {/* Cast as individual items */}
      {title.cast.length > 0 && (
        <div className="mt-4">
          <h2 className="text-sm font-medium">Cast</h2>
          <ul className="mt-1 space-y-0.5 text-sm text-gray-700">
            {title.cast.map((c, i) => (
              <li key={i}>{c.name}{c.character ? <span className="text-gray-400"> as {c.character}</span> : null}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Note */}
      <div className="mt-4">
        <label className="text-sm font-medium">Note</label>
        <textarea
          value={note} onChange={(e) => setNote(e.target.value)} rows={3}
          className="mt-1 w-full rounded-lg border p-2 text-sm"
          placeholder="Who recommended it, talking points, thoughts…"
        />
        <button onClick={() => patch({ note })} className="mt-1 rounded-lg bg-black px-3 py-2 text-sm text-white" disabled={saving}>
          Save note
        </button>
      </div>

      {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

      {/* Actions */}
      <div className="mt-6 flex flex-wrap gap-2">
        <button onClick={toggleStatus} className="rounded-lg border px-3 py-2 text-sm">
          {status === "WANT" ? "Mark as watched" : "Move to want to watch"}
        </button>
        <button onClick={refresh} className="rounded-lg border px-3 py-2 text-sm" disabled={saving}>Refresh</button>
        <button onClick={remove} className="rounded-lg border border-red-300 px-3 py-2 text-sm text-red-600">Remove</button>
      </div>
    </main>
  );
}
