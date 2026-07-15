"use client";

export function ListToggle({
  value,
  onChange,
  counts,
}: {
  value: "WANT" | "WATCHED";
  onChange: (v: "WANT" | "WATCHED") => void;
  counts?: { WANT: number | null; WATCHED: number | null };
}) {
  const base = "relative z-10 flex-1 rounded-lg px-2 py-3 text-sm font-medium transition-colors active:opacity-70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground";
  const active = "text-foreground";
  const inactive = "text-gray-500 hover:text-foreground";
  return (
    <div className="rounded-xl bg-gray-100 p-1 dark:bg-white/5" role="group" aria-label="Filter by list">
      <div className="relative flex">
        <div
          aria-hidden="true"
          className={`absolute inset-y-0 w-1/2 rounded-lg bg-white shadow transition-transform dark:bg-white/15 ${value === "WATCHED" ? "translate-x-full" : "translate-x-0"}`}
        />
        <button
          className={`${base} ${value === "WANT" ? active : inactive}`}
          onClick={() => onChange("WANT")}
          aria-pressed={value === "WANT"}
        >
          Want to watch{counts?.WANT != null && <span className="ml-1.5 meta">{counts.WANT}</span>}
        </button>
        <button
          className={`${base} ${value === "WATCHED" ? active : inactive}`}
          onClick={() => onChange("WATCHED")}
          aria-pressed={value === "WATCHED"}
        >
          Watched{counts?.WATCHED != null && <span className="ml-1.5 meta">{counts.WATCHED}</span>}
        </button>
      </div>
    </div>
  );
}
