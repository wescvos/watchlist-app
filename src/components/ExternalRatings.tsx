function Rating({ label, value }: { label: string; value: string | number | null }) {
  return (
    <div className="rounded-lg bg-gray-100 px-3 py-2 text-center dark:bg-white/5">
      <div className="meta">{label}</div>
      <div className="font-mono font-semibold">{value ?? "N/A"}</div>
    </div>
  );
}

export function ExternalRatings({
  tmdbScore,
  imdbScore,
  rtScore,
  metacriticScore,
}: {
  tmdbScore: number | null;
  imdbScore: string | null;
  rtScore: string | null;
  metacriticScore: string | null;
}) {
  return (
    <div className="mt-4 grid grid-cols-4 gap-2">
      <Rating label="TMDb" value={tmdbScore} />
      <Rating label="IMDb" value={imdbScore} />
      <Rating label="RT" value={rtScore} />
      <Rating label="Meta" value={metacriticScore} />
    </div>
  );
}
