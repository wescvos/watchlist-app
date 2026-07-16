"use client";
import Link from "next/link";

const CLASSES = "-ml-2.5 flex h-11 w-11 items-center justify-center rounded-full text-gray-500 transition-colors hover:bg-gray-100 hover:text-foreground active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground dark:hover:bg-white/10 dark:active:bg-white/10";

function Chevron() {
  return (
    <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  );
}

export function BackLink({ href, label, onClick }: { href?: string; label: string; onClick?: () => void }) {
  if (onClick) {
    return (
      <button type="button" onClick={onClick} aria-label={label} className={CLASSES}>
        <Chevron />
      </button>
    );
  }
  return (
    <Link href={href ?? "/"} aria-label={label} className={CLASSES}>
      <Chevron />
    </Link>
  );
}
