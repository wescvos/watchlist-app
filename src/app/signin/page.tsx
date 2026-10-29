import { signIn } from "@/auth";

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  async function google() {
    "use server";
    await signIn("google", { redirectTo: "/" });
  }

  return (
    <main className="min-h-screen flex items-center justify-center p-6">
      <form action={google} className="w-full max-w-xs space-y-4">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/icons/icon-192.png" alt="" width={64} height={64} className="mx-auto rounded-2xl" />
        <p className="text-center meta">Private library</p>
        <h1 className="text-xl font-semibold text-center">Watchlist</h1>
        {error === "AccessDenied" && (
          <p role="alert" className="text-sm text-center text-red-600 dark:text-red-400">
            You&apos;re not on the invite list. Ask Wesley to add you.
          </p>
        )}
        {error && error !== "AccessDenied" && (
          <p role="alert" className="text-sm text-center text-red-600 dark:text-red-400">
            Sign-in didn&apos;t complete (code: {error}). Try again, or open the app in Safari and sign in there.
          </p>
        )}
        <button className="w-full rounded-lg bg-foreground p-3 font-medium text-background transition-opacity hover:opacity-90 active:opacity-80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground focus-visible:ring-offset-2 focus-visible:ring-offset-background">
          Sign in with Google
        </button>
      </form>
    </main>
  );
}
