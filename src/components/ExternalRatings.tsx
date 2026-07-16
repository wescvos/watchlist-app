function ImdbMark() {
  return (
    <span className="inline-flex items-center justify-center rounded border border-current px-1 py-0.5 text-[9px] font-bold uppercase leading-none tracking-wide">
      IMDb
    </span>
  );
}

function RtMark() {
  return (
    <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="12" cy="14" r="7" />
      <path d="M8.5 8c0-2.2 1.6-4 3.5-4s3.5 1.8 3.5 4" />
      <path d="M12 4v3" />
    </svg>
  );
}

function Rating({ label, icon, value }: { label?: string; icon?: React.ReactNode; value: string | number | null }) {
  return (
    <div className="rounded-lg bg-gray-100 px-3 py-2 text-center dark:bg-white/5">
      <div className="flex items-center justify-center text-gray-500">
        {icon ?? <span className="meta">{label}</span>}
      </div>
      <div className="mt-0.5 font-mono font-semibold">{value ?? "N/A"}</div>
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
      <Rating label="TMDb" value={tmdbScore != null ? tmdbScore.toFixed(1) : null} />
      <Rating icon={<ImdbMark />} value={imdbScore} />
      <Rating icon={<RtMark />} value={rtScore} />
      <Rating label="Meta" value={metacriticScore} />
    </div>
  );
}
