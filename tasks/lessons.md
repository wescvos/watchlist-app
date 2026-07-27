# Lessons

## Dark mode: fix systemically, not one screen at a time

**Context:** While polishing the search screen, the user hit the same "text is invisible in dark mode" bug three separate times (title detail pills/rating tiles, then the home ListToggle) because the whole app was authored light-mode only.

**Pattern:** This app declares `prefers-color-scheme: dark` in `globals.css` (foreground flips to light), but individual screens hardcode light fills (`bg-gray-100`, `bg-gray-200`, `bg-white`) and light-mode buttons (`bg-black text-white`) with no `dark:` variant. In dark mode the light foreground text then sits on a light fill and disappears.

**Rule:** When touching or reviewing any UI in this repo, do NOT fix only the screen in front of you. Grep the whole `src` tree for light-only utilities first and fix them together:
`bg-gray-100|bg-gray-200|bg-gray-50|bg-white|bg-black|text-white|text-gray-700|text-gray-800|text-gray-900`
Any hit without a matching `dark:` variant is a latent invisible-text bug.

**Established tokens (use these, they auto-adapt):**
- Primary button/action: `bg-foreground text-background` (never `bg-black text-white`).
- Subtle fill: `bg-gray-100 dark:bg-white/5` (or `bg-gray-50 dark:bg-white/5` for inputs).
- Poster/placeholder: `bg-gray-200 ring-1 ring-black/5 dark:bg-white/10 dark:ring-white/10`.
- Hairline border: `border-black/10 dark:border-white/10` (buttons: `/12` and `/15`).
- Muted text: `text-gray-500` (visible in both). Dark-only-invisible text like `text-gray-700` needs `dark:text-gray-300`.
- Segmented active tab: `bg-white text-foreground shadow dark:bg-white/15`; inactive: `text-gray-500 hover:text-foreground`.

## Generating Prisma migrations without touching the live DB

**Context:** This project has one shared Neon Postgres instance for dev and prod (no separate shadow/dev DB), and schema changes are meant to apply only via the build's `prisma migrate deploy` step, never manually. While generating the `add_watch_providers` migration, `prisma migrate dev --create-only` silently applied the previous, still-pending `add_season_episode_counts` migration to the live DB as a side effect — caught only by explicitly querying `information_schema.columns` and `_prisma_migrations` afterward.

**Pattern:** `migrate dev` (even with `--create-only`) always syncs the connected database to the existing migration history first, then diffs schema.prisma against that up-to-date state to create the new migration. `--create-only` only skips applying the *new* migration being generated — it does not skip applying any *already-pending* ones. If a previous migration was generated but never deployed, running `migrate dev --create-only` again will quietly apply it.

**Rule:** To generate a migration file without any risk of touching the live database, use `prisma migrate diff` against the live schema instead, e.g. `prisma migrate diff --from-database-url "$DATABASE_URL" --to-schema-datamodel prisma/schema.prisma --script > prisma/migrations/<timestamp>_<name>/migration.sql` (read-only introspection + diff, never applies anything). Before pushing any migration, also run `prisma migrate status` to confirm the local migration folder and `_prisma_migrations` history agree (no drift, no checksum mismatch) so `migrate deploy` on the next build applies cleanly.

## Verifying this app locally

- Auth is a passcode gate (`middleware.ts` + `/api/auth`, cookie `wl_auth`). Passcode is in `.env.local` (`APP_PASSCODE`).
- To drive a page headless: `curl.exe -c jar -X POST /api/auth --data @body.json` (body from a file so PowerShell doesn't mangle `%` in the passcode), then `curl.exe -b jar <url>`.
- Home page, search results, and title cards are **client-fetched** — they are NOT in the raw server HTML. Verify those states in a real browser; raw curl only confirms the initial/empty server render.
- `Invoke-WebRequest` needs `-UseBasicParsing` in Windows PowerShell 5.1; `curl.exe` is simpler.
- Dev-server hygiene: `next dev` refuses to start if another instance is running and leaves stray `node` processes. Kill strays before starting: filter `Win32_Process` node.exe by `CommandLine -match 'next'`. Don't reuse `$HOME` as a variable name — it's read-only in PowerShell.

## External choices verified at build time can drift under you

**Context:** Twice an externally-verified decision changed after it was made. First: Vercel/Prisma build behavior (needs `prisma generate` in the build + a direct, non-"Sensitive" `DATABASE_URL`, or builds intermittently fail). Then: `gemini-2.5-flash`, verified current and free-tier when chosen, was later retired for *new* API keys and returns 404 — while still appearing in the ListModels catalog. The model list lied; only an actual call revealed it.

**Pattern:** Third-party APIs and platform build behavior move independently of your code. A model id, endpoint, free-tier boundary, or build-env assumption that was correct at write time can silently break later, and a catalog/list endpoint can advertise a resource that no longer works.

**Rule:**
- Prefer version-resilient choices where they exist: rolling aliases (`gemini-flash-latest`) over pinned versions that can be retired; stable endpoints over preview ones.
- Verify by *exercising* the dependency (a real call), not by trusting a catalog/list endpoint — a listed model can still 404.
- Never swallow an external error into a generic status. Log the raw external error body server-side (status + body, minus any secret/PII); it names the real cause (retired model, quota, bad schema) that a generic 502 hides. This is what turned a blind "Couldn't refresh" into a one-look diagnosis.
