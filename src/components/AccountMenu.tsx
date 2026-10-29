"use client";
import { signOut, useSession } from "next-auth/react";
import { UID_COOKIE } from "@/lib/clientUser";
import { clearAllPersistedLists } from "@/lib/listPersist";

function firstName(name?: string | null, email?: string | null): string | null {
  const fromName = name?.trim().split(/\s+/)[0];
  if (fromName) return fromName;
  const local = email?.split("@")[0];
  return local || null;
}

export function AccountMenu() {
  const { data } = useSession();
  // Nothing while the session loads: the header's flex-end group then simply
  // grows leftwards once it resolves, and nothing already visible moves.
  if (!data?.user) return null;
  const label = firstName(data.user.name, data.user.email);

  function handleSignOut() {
    // Private data must not outlive the session on a shared device.
    clearAllPersistedLists();
    document.cookie = `${UID_COOKIE}=; path=/; max-age=0`;
    // Full navigation, which also resets the in-memory listCache/searchCache.
    void signOut({ redirectTo: "/signin" });
  }

  return (
    <div className="flex items-center gap-1">
      {label && <span className="max-w-24 truncate text-sm text-gray-500">{label}</span>}
      <button
        type="button"
        onClick={handleSignOut}
        className="rounded-lg px-2 py-2 text-sm font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-foreground active:bg-gray-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground dark:hover:bg-white/10 dark:active:bg-white/10"
      >
        Sign out
      </button>
    </div>
  );
}
