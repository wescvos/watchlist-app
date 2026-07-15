"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ListToggle } from "@/components/ListToggle";
import { TitleCard, type CardTitle } from "@/components/TitleCard";

export default function Home() {
  const [status, setStatus] = useState<"WANT" | "WATCHED">("WANT");
  const [titles, setTitles] = useState<CardTitle[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let ignore = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- intentional loading flag for fetch-on-status-change
    setLoading(true);
    fetch(`/api/titles?status=${status}`)
      .then((r) => r.json())
      .then((data) => {
        if (!ignore) setTitles(data);
      })
      .finally(() => {
        if (!ignore) setLoading(false);
      });
    return () => {
      ignore = true;
    };
  }, [status]);

  return (
    <main className="mx-auto max-w-2xl p-4 pb-24">
      <div className="mb-4 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Watchlist</h1>
        <Link href="/search" className="rounded-lg bg-black px-3 py-2 text-sm text-white">+ Add</Link>
      </div>
      <ListToggle value={status} onChange={setStatus} />
      {loading ? (
        <p className="mt-8 text-center text-sm text-gray-500">Loading…</p>
      ) : titles.length === 0 ? (
        <p className="mt-8 text-center text-sm text-gray-500">Nothing here yet.</p>
      ) : (
        <div className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4">
          {titles.map((t) => <TitleCard key={t.id} t={t} />)}
        </div>
      )}
    </main>
  );
}
