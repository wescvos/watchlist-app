"use client";

export function ListToggle({ value, onChange }: { value: "WANT" | "WATCHED"; onChange: (v: "WANT" | "WATCHED") => void }) {
  const base = "flex-1 rounded-lg p-2 text-sm font-medium";
  return (
    <div className="flex gap-2 rounded-xl bg-gray-100 p-1">
      <button className={`${base} ${value === "WANT" ? "bg-white shadow" : ""}`} onClick={() => onChange("WANT")}>
        Want to watch
      </button>
      <button className={`${base} ${value === "WATCHED" ? "bg-white shadow" : ""}`} onClick={() => onChange("WATCHED")}>
        Watched
      </button>
    </div>
  );
}
