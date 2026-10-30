"use client";
import { useState } from "react";

/** Round profile photo, falling back to the first initial if missing or broken. */
export function Avatar({ person }: { person: { firstName: string; image: string | null } }) {
  const [failed, setFailed] = useState(false);
  if (person.image && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={person.image}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="h-9 w-9 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span
      aria-hidden="true"
      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gray-200 text-sm font-medium dark:bg-white/15"
    >
      {person.firstName.charAt(0).toUpperCase()}
    </span>
  );
}
