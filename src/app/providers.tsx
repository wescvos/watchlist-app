"use client";
import { SessionProvider } from "next-auth/react";

// No server-provided session on purpose: the root layout stays static so a cold
// launch is never blocked on auth. The client fetches the session itself.
export function Providers({ children }: { children: React.ReactNode }) {
  return <SessionProvider>{children}</SessionProvider>;
}
