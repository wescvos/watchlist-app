# Multi-User (Friends) Support Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each allowlisted friend signs in with Google and gets a private list, while title metadata stays shared and Wesley's existing list moves to his account intact.

**Architecture:** Auth.js v5 (JWT sessions, Google provider, no DB session tables) replaces the passcode. `Title` becomes a shared catalog; a new `ListEntry` table holds per-user status/note/rating/pin/dates. Every server read and write goes through a `userId` taken from the session, and `src/proxy.ts` (Next 16's renamed middleware) does only the optimistic redirect plus a `wl_uid` cookie that namespaces the client's localStorage cache.

**Tech Stack:** Next.js 16.2 (App Router, Proxy), React 19.2, Prisma 7 + Neon Postgres, `next-auth@5.0.0-beta.32` (peer range includes Next 16 and React 19), Vitest + Testing Library.

**Spec:** `docs/superpowers/specs/2026-10-29-multi-user-design.md`

## Global Constraints

- Allowlist env var: `ALLOWED_EMAILS`, comma separated, compared case-insensitively and trimmed. Emails are stored lowercase in `User.email`.
- Owner of existing data: `wesley@vosk.co.za`.
- Auth env vars (Auth.js v5 defaults): `AUTH_SECRET`, `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`.
- Session lifetime: 365 days (matches today's "remember this device").
- `APP_PASSCODE` is removed from code but stays set in Vercel until release 2.
- Personal fields, exact names: `status`, `note`, `myRating`, `pinned`, `pinnedAt`, `addedAt`, `watchedAt`.
- `ListEntry -> Title` FK is `ON DELETE RESTRICT`; `ListEntry -> User` is `ON DELETE CASCADE`. New code never deletes `Title` rows.
- A title id the user has no entry for is "not found" (404), never 403.
- Migrations: `prisma migrate diff --from-schema <(git show HEAD:prisma/schema.prisma) --to-schema prisma/schema.prisma --script`, never `migrate dev` (AGENTS.md).
- Work on a local branch `multi-user`. **Nothing is pushed until Task 9.** Every earlier commit stays local, because the build runs `prisma migrate deploy` and a half-done release would break the live app.
- Verify steps are separate commands (`npx tsc --noEmit`, `npx eslint`, `npx vitest run`, `npx next build`); never chain verify with push. `git add` explicit paths only. Never em dashes in copy.
- Read `node_modules/next/dist/docs/01-app/02-guides/authentication.md` and `.../03-api-reference/03-file-conventions/proxy.md` before Tasks 2 and 3.

## Review Focus

1. **A signed-in user removed from `ALLOWED_EMAILS`** still has a valid year-long JWT. Expected: proxy redirects/401s and `getCurrentUserId()` returns null. Tests in Tasks 2 and 3.
2. **User B uses user A's title id** on PATCH, DELETE, refresh, or `/title/[id]`. Expected: 404 for API, redirect to `/preview/...` for the page, A's entry unchanged. Tests in Tasks 4 and 5.
3. **Two users add the same title.** Expected: B's add creates only an entry (no TMDB fetch), A's entry untouched; A removing it leaves B's entry and the catalog row. Re-adding a title already on your own list leaves its status/note intact. Tests in Task 4.
4. **Shared device: A signs out, B signs in.** Expected: B's first paint never seeds from A's cached list; with no `wl_uid` cookie nothing is read or written. Tests in Task 7.
5. **Email casing** (`Wesley@Vosk.co.za` from Google). Expected: allowed, and maps to the same `User` row as the migrated lowercase email. Tests in Task 2.

---

### Task 1: Schema and release 1 migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_multi_user/migration.sql`

**Interfaces:**
- Produces: Prisma models `User { id, email @unique, name?, image?, createdAt, entries ListEntry[] }`, `ListEntry { id, userId, titleId, status Status @default(WANT), note?, myRating?, pinned @default(false), pinnedAt?, addedAt @default(now()), watchedAt?, user, title; @@unique([userId, titleId]); @@index([userId, status]) }`, and back-relation `Title.entries ListEntry[]`. Compound unique accessor: `userId_titleId`. `Title` keeps its personal columns, with a comment marking them as release-1 leftovers dropped in release 2.

- [ ] **Step 1:** `git checkout -b multi-user`.
- [ ] **Step 2:** Edit the schema as above. Relations: `user User @relation(fields:[userId], references:[id], onDelete: Cascade)`, `title Title @relation(fields:[titleId], references:[id], onDelete: Restrict)`.
- [ ] **Step 3:** Run `npx prisma validate`. Expected: "The schema ... is valid".
- [ ] **Step 4:** Confirm `npx prisma migrate status` reports no pending migrations, then generate the DDL schema-to-schema: write `git show HEAD:prisma/schema.prisma` to a temp file outside the repo and run `npx prisma migrate diff --from-schema <tmp> --to-schema prisma/schema.prisma --script > prisma/migrations/<UTC timestamp>_multi_user/migration.sql`. Expected: CREATE TABLE for `User` and `ListEntry`, the unique/index, two FKs, nothing touching existing columns.
- [ ] **Step 5:** Append the backfill to the end of that file, by hand:

```sql
-- Backfill: the whole existing list belongs to the owner account.
INSERT INTO "User" ("id", "email", "createdAt")
VALUES (gen_random_uuid()::text, 'wesley@vosk.co.za', now());

INSERT INTO "ListEntry" ("id", "userId", "titleId", "status", "note", "myRating", "pinned", "pinnedAt", "addedAt", "watchedAt")
SELECT gen_random_uuid()::text, u."id", t."id", t."status", t."note", t."myRating", t."pinned", t."pinnedAt", t."addedAt", t."watchedAt"
FROM "Title" t CROSS JOIN "User" u
WHERE u."email" = 'wesley@vosk.co.za';
```

- [ ] **Step 6:** `npx prisma generate`. Expected: success. (The app will not type-check until Task 4; that is expected and fine because nothing is pushed.)
- [ ] **Step 7:** Commit `prisma/schema.prisma` and the migration folder: `feat(db): add User and ListEntry with owner backfill`.

### Task 2: Auth.js, allowlist, current-user helpers

**Files:**
- Create: `src/lib/allowlist.ts`, `src/auth.ts`, `src/app/api/auth/[...nextauth]/route.ts`, `src/lib/currentUser.ts`, `src/types/next-auth.d.ts`
- Delete: `src/app/api/auth/route.ts`, `src/app/api/__tests__/auth.test.ts`
- Modify: `package.json` (dependency), `src/lib/env.ts` (drop `passcode`), `src/lib/__tests__/env.test.ts` if it covers `passcode`
- Test: `src/lib/__tests__/allowlist.test.ts`, `src/lib/__tests__/currentUser.test.ts`

**Interfaces:**
- Produces:
  - `isAllowedEmail(email: string | null | undefined, raw: string | undefined = process.env.ALLOWED_EMAILS): boolean`
  - `src/auth.ts` exports `{ handlers, auth, signIn, signOut }` from `NextAuth(...)`. `session.user.id: string` (the `User.id`), `session.user.email`.
  - `getCurrentUserId(): Promise<string | null>` and `requireUserId(): Promise<string>` (calls `redirect("/signin")` when null), both in `src/lib/currentUser.ts`.

- [ ] **Step 1:** `npm install next-auth@5.0.0-beta.32`.
- [ ] **Step 2: Failing tests** in `allowlist.test.ts`:
  - `isAllowedEmail("a@x.com", "a@x.com, b@y.com")` is true; `"B@Y.com"` is true; `" b@y.com "` is true.
  - `isAllowedEmail("c@z.com", "a@x.com")` is false; `null`/`undefined`/`""` email is false.
  - Unset or empty `raw` denies everything (fail closed), including `isAllowedEmail("", "")`.
- [ ] **Step 3:** Run `npx vitest run src/lib/__tests__/allowlist.test.ts`. Expected: FAIL (module missing).
- [ ] **Step 4:** Implement `isAllowedEmail`.
- [ ] **Step 5:** Run it again. Expected: PASS.
- [ ] **Step 6:** Implement `src/auth.ts`: Google provider; `session: { strategy: "jwt", maxAge: 60 * 60 * 24 * 365 }`; `pages: { signIn: "/signin", error: "/signin" }`; callbacks:
  - `signIn({ user })` returns `isAllowedEmail(user.email)` (false makes Auth.js redirect to `/signin?error=AccessDenied`).
  - `jwt({ token, user })`: when `user` is present (first sign-in), `prisma.user.upsert` by `email.toLowerCase()` (update name/image), store `token.uid = dbUser.id`.
  - `session({ session, token })`: `session.user.id = token.uid`.
  Add the module augmentation in `src/types/next-auth.d.ts`. The route file is `export const { GET, POST } = handlers;`.
- [ ] **Step 7: Failing tests** in `currentUser.test.ts` (mock `@/auth`'s `auth` and `next/navigation`'s `redirect`):
  - session `{ user: { id: "u1", email: "a@x.com" } }` with `ALLOWED_EMAILS=a@x.com` gives `"u1"`.
  - same session with `ALLOWED_EMAILS=b@y.com` gives `null` (removed friend, Review Focus 1).
  - `null` session gives `null`; session without `user.id` gives `null`.
  - `requireUserId()` with no session calls `redirect("/signin")`.
- [ ] **Step 8:** Implement `getCurrentUserId` / `requireUserId`, run the tests. Expected: PASS.
- [ ] **Step 9:** Add a test in `currentUser.test.ts` or a new `auth.test.ts` that the `jwt` callback lowercases `Wesley@Vosk.co.za` before the upsert (export the callbacks object from `src/auth.ts` as `authCallbacks` so it is testable with a mocked `prisma.user.upsert`). Run. Expected: PASS.
- [ ] **Step 10:** Delete the passcode route and its test, drop `passcode` from `env.ts`. Commit all files above: `feat(auth): Google sign-in with email allowlist`.

### Task 3: Proxy, sign-in page, remove the gate

**Files:**
- Create: `src/proxy.ts`, `src/app/signin/page.tsx`
- Delete: `src/middleware.ts`, `src/__tests__/middleware.test.ts`, `src/app/gate/page.tsx`, `src/lib/hash.ts` (if nothing else imports it)
- Test: `src/__tests__/proxy.test.ts`

**Interfaces:**
- Consumes: `auth` from `@/auth`, `isAllowedEmail`.
- Produces: `handleProxy(req: NextRequest & { auth: Session | null }): NextResponse` (pure, exported for tests), `export const proxy = auth(handleProxy)`, `config.matcher` unchanged from today's middleware. Cookie `wl_uid` = `session.user.id`, not httpOnly, `sameSite: "lax"`, `secure` in production, `path: "/"`, `maxAge` 365 days. Constant `UID_COOKIE = "wl_uid"` exported from `src/lib/clientUser.ts` (create the file here with just the constant; Task 7 adds the reader).

- [ ] **Step 1: Failing tests** for `handleProxy`, building `NextRequest`s and attaching `auth`:
  - `/signin` and `/api/auth/callback/google` pass through with no session.
  - `/` with no session redirects to `/signin`; `/api/titles` with no session returns 401 JSON.
  - Session whose email is not in `ALLOWED_EMAILS` behaves like no session (Review Focus 1).
  - Valid session on `/` passes through and sets `wl_uid=<id>` when the request cookie is absent or different; does not set it when it already matches.
- [ ] **Step 2:** Run `npx vitest run src/__tests__/proxy.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `src/proxy.ts`, delete the old middleware and its test.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Build `src/app/signin/page.tsx` (server component): app icon and name, a form whose server action calls `signIn("google", { redirectTo: "/" })`, button "Sign in with Google". When `searchParams.error === "AccessDenied"` show "You're not on the invite list. Ask Wesley to add you." above the button. Match the existing visual style (see the old `/gate` page before deleting it).
- [ ] **Step 6:** Delete `/gate` and `hash.ts` (grep for importers first). Commit: `feat(auth): proxy and sign-in page replace the passcode gate`.

### Task 4: Per-user data layer

**Files:**
- Modify: `src/lib/titles.ts`
- Test: `src/lib/__tests__/titles.test.ts` (rewrite the prisma mock to include `listEntry` and `title`)

**Interfaces:**
- Produces (all in `src/lib/titles.ts`):
  - `type PersonalField = "status" | "note" | "myRating" | "pinned" | "pinnedAt" | "addedAt" | "watchedAt"`
  - `type ListedTitle = Omit<Title, PersonalField> & Pick<ListEntry, PersonalField>` where `id` is the **Title** id (so `/title/[id]` URLs and client code are unchanged). Survives release 2 unchanged.
  - `addTitle(userId: string, tmdbId: number, mediaType: MediaKind, status?: Status): Promise<ListedTitle>`
  - `listTitles(userId: string, status?: Status): Promise<ListedTitle[]>`
  - `getTitle(userId: string, titleId: string): Promise<ListedTitle | null>`
  - `updateTitle(userId: string, titleId: string, patch: TitlePatch): Promise<ListedTitle | null>` (null = no entry). `TitlePatch` is today's patch type, exported.
  - `deleteTitle(userId: string, titleId: string): Promise<boolean>` (false = no entry)
  - `refreshTitle(titleId: string): Promise<Title>` (unchanged, shared catalog)
  - `getCatalogTitle(titleId: string): Promise<{ tmdbId: number; mediaType: MediaType } | null>`
  - `isStale` unchanged.

- [ ] **Step 1: Failing tests** (mocked prisma):
  - `addTitle` when the catalog row exists: does **not** call `fetchMergedTitle`, upserts `listEntry` on `userId_titleId` with `update: {}` and `create: { userId, titleId, status, watchedAt }` (Review Focus 3, including "re-adding your own title leaves it intact").
  - `addTitle` when the catalog row is missing: calls `fetchMergedTitle`, upserts `title` on `tmdbId_mediaType`, then creates the entry; `status: WATCHED` sets `watchedAt`.
  - `addTitle` result has `id` equal to the title id and personal fields from the entry, not from the title row.
  - `listTitles("u1", WANT)` queries `listEntry.findMany` with `where: { userId: "u1", status: "WANT" }`, `include: { title: true }`, ordering `pinned desc, pinnedAt desc, addedAt desc`; WATCHED orders `watchedAt desc, addedAt desc`.
  - `updateTitle` keeps today's rules (status WATCHED sets `watchedAt` and unpins; pinning sets `pinnedAt`) and targets `where: { userId_titleId: { userId, titleId } }`; a P2025 from prisma returns `null` (Review Focus 2).
  - `deleteTitle` uses `listEntry.deleteMany({ where: { userId, titleId } })`, returns `true` for count 1 and `false` for 0, and never calls `prisma.title.delete`.
  - `getTitle` returns `null` when no entry exists for that user.
- [ ] **Step 2:** Run `npx vitest run src/lib/__tests__/titles.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. One private `toListed(entry: ListEntry & { title: Title }): ListedTitle` that spreads the title, then copies only the seven personal fields from the entry.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit `src/lib/titles.ts` and the test: `feat: per-user list entries over a shared title catalog`.

### Task 5: Scope the API routes

**Files:**
- Modify: `src/app/api/titles/route.ts`, `src/app/api/titles/[id]/route.ts`, `src/app/api/titles/[id]/refresh/route.ts`, `src/app/api/search/route.ts`
- Test: `src/app/api/__tests__/routes.test.ts` (add `vi.mock("@/lib/currentUser")`, `prisma.listEntry.findMany` to the prisma mock)

**Interfaces:**
- Consumes: `getCurrentUserId`, Task 4 functions.
- Produces: unchanged request/response shapes. Every handler starts with `const userId = await getCurrentUserId(); if (!userId) return 401 { error: "Unauthorized" }`.

- [ ] **Step 1: Failing tests:**
  - Each of GET/POST `/api/titles`, PATCH/DELETE `/api/titles/[id]`, POST refresh, GET search returns 401 when `getCurrentUserId` resolves `null`, and calls no data function.
  - PATCH and DELETE pass `"u1"` through and return 404 when `updateTitle` returns `null` / `deleteTitle` returns `false` (Review Focus 2).
  - Refresh returns 404 and does **not** call `refreshTitle` or `tagIfUntagged` when `getTitle("u1", id)` is `null`; on success it calls `refreshTitle(id)` then returns `getTitle("u1", id)`.
  - POST add still schedules `tagIfUntagged(title.id)` via `after()`.
  - Search builds `library` markers only from `prisma.listEntry.findMany` with `where.userId === "u1"`.
- [ ] **Step 2:** Run `npx vitest run src/app/api/__tests__/routes.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement. Remove the `isNotFound` helper from `[id]/route.ts` (the data layer now returns null/false).
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit the four routes and the test: `feat(api): scope every title route to the signed-in user`.

### Task 6: Scope the server pages

**Files:**
- Modify: `src/app/title/[id]/page.tsx`, `src/app/mood/page.tsx`, `src/app/mood/[slug]/page.tsx`
- Test: `src/app/mood/__tests__/mood.test.tsx`, create `src/app/title/__tests__/title-page.test.tsx`

**Interfaces:**
- Consumes: `requireUserId`, `getTitle`, `getCatalogTitle`, `refreshTitle`, `isStale`.

- [ ] **Step 1: Failing tests:**
  - Title page: no entry for this user but catalog row exists calls `redirect("/preview/MOVIE/123")` (lowercase/uppercase per the existing preview route's `mediaType` segment; check `src/app/preview/[mediaType]/[tmdbId]/page.tsx`); neither exists calls `notFound()` (Review Focus 2). Stale entry refreshes then re-reads via `getTitle(userId, id)`.
  - Mood index: queries `prisma.listEntry.findMany` with `where: { userId: "u1", status: "WANT" }` and selects `addedAt` plus `title: { select: { moods, moodsTaggedAt, posterUrl, imdbScore } }`, mapped into today's `PickerTitle` shape; counts reflect only that user's entries.
  - Mood slug: `where: { userId: "u1", status: "WANT", title: { moods: { has: label } } }`, same ordering as `listTitles` WANT.
- [ ] **Step 2:** Run `npx vitest run src/app/mood src/app/title`. Expected: FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5:** Commit: `feat: scope title detail and mood pages to the signed-in user`.

### Task 7: Per-user client cache and sign-out

**Files:**
- Modify: `src/lib/clientUser.ts` (add reader), `src/lib/listPersist.ts`, `src/app/layout.tsx`, `src/app/page.tsx` (place the account control)
- Create: `src/app/providers.tsx` (client `SessionProvider` wrapper), `src/components/AccountMenu.tsx`
- Test: `src/lib/__tests__/listPersist.test.ts`, create `src/components/__tests__/AccountMenu.test.tsx`

**Interfaces:**
- Produces:
  - `readClientUserId(): string | null` (parses `document.cookie` for `UID_COOKIE`; null on server or when absent).
  - `listPersist` storage key becomes `` `watchlist:lists:${uid}` ``; every read/write/clear resolves the key through `readClientUserId()` and is a no-op (read returns null) when it is null. Existing exports keep their signatures.
  - `clearAllPersistedLists(): void` removes every localStorage key starting with `watchlist:lists` (covers the legacy unscoped key too).
  - `AccountMenu`: shows the signed-in first name (from `useSession`), and a "Sign out" button that calls `clearAllPersistedLists()`, expires `wl_uid`, then `signOut({ redirectTo: "/signin" })` from `next-auth/react` (full navigation, which also resets `listCache`/`searchCache`).

- [ ] **Step 1: Failing tests** (`listPersist.test.ts`, setting `document.cookie`):
  - With `wl_uid=a`, `persistLists` writes `watchlist:lists:a`; switching the cookie to `wl_uid=b`, `readPersistedLists()` returns null and `hydrateListCache()` returns false (Review Focus 4).
  - With no `wl_uid`, `persistLists` writes nothing and `readPersistedLists` returns null.
  - `clearAllPersistedLists` removes `watchlist:lists`, `watchlist:lists:a`, `watchlist:lists:b` and leaves an unrelated key.
  - Existing tests keep passing once they set a `wl_uid` cookie in `beforeEach`.
- [ ] **Step 2:** Run `npx vitest run src/lib/__tests__/listPersist.test.ts`. Expected: FAIL.
- [ ] **Step 3:** Implement `readClientUserId`, the key change, and `clearAllPersistedLists`.
- [ ] **Step 4:** Run the tests. Expected: PASS.
- [ ] **Step 5: Failing test** (`AccountMenu.test.tsx`, mocking `next-auth/react`): clicking "Sign out" calls `clearAllPersistedLists` before `signOut` with `{ redirectTo: "/signin" }`; renders the first name from the session.
- [ ] **Step 6:** Implement `AccountMenu` and `providers.tsx`; wrap `children` in `layout.tsx` with the provider (the layout must stay static: no `auth()` call in it, so cold launch is unaffected). Place `AccountMenu` in the home page header. The existing empty states ("Nothing on your list" + "Search titles") already satisfy spec section 11; leave them.
- [ ] **Step 7:** Run `npx vitest run`. Expected: all PASS, including `src/app/__tests__/home-cold-launch.test.tsx`.
- [ ] **Step 8:** Commit: `feat: per-user list cache and sign-out`.

### Task 8: Scripts and docs

**Files:**
- Modify: `scripts/tag-all-moods.ts`, `scripts/clear-want-moods.ts`, `scripts/refresh-all-titles.ts`, `scripts/import-google-takeout.ts`, `README.md`, `AGENTS.md`
- Create: `scripts/check-multi-user-migration.ts`

**Interfaces:**
- Consumes: Task 4 `addTitle(userId, ...)`.
- "On a Want list" filter used by the first three scripts: `{ entries: { some: { status: "WANT" } } }` on `Title`. `tag-all-moods` keeps "Want first" by running the Want-listed query before the rest rather than ordering by `status`.
- `import-google-takeout.ts` takes a required `--email <address>`, resolves the `User` (exit with an error if missing), calls `addTitle(user.id, ...)`, and sets `watchedAt` with `prisma.listEntry.update` on `userId_titleId`.
- `check-multi-user-migration.ts` (read-only): prints the `Title` count, the owner's `ListEntry` count, and the number of titles whose old personal columns differ from the owner's entry. Exits non-zero unless the counts match and the diff is 0.

- [ ] **Step 1:** Update the four scripts. `npx tsc --noEmit` compiles them (confirm `tsconfig` includes `scripts/`; if not, run `npx tsc --noEmit -p .` with them included, or `npx tsx --check` per script).
- [ ] **Step 2:** Write the check script.
- [ ] **Step 3:** README: replace the passcode setup with the env vars and the "add a friend" procedure (add the address to `ALLOWED_EMAILS` in Vercel, redeploy). AGENTS.md: add an "Auth" bullet: authorization is per route via `getCurrentUserId`/`requireUserId`, the proxy is only an optimistic check, and title ids are never trusted without the user's entry.
- [ ] **Step 4:** Commit: `chore: scripts and docs for multi-user`.

### Task 9: Verify, set up Google, ship release 1

- [ ] **Step 1:** `npx next build`. Expected: success (also refreshes `.next/types` after the route removals).
- [ ] **Step 2:** `npx tsc --noEmit`. Expected: no errors.
- [ ] **Step 3:** `npx eslint`. Expected: no errors.
- [ ] **Step 4:** `npx vitest run`. Expected: all pass.
- [ ] **Step 5:** Request a whole-branch code review (superpowers:requesting-code-review) and fix what it confirms.
- [ ] **Step 6: Wesley does this** (give him these steps verbatim, with the app's production domain filled in):
  1. Go to console.cloud.google.com, create a project called "Watchlist".
  2. Open "Google Auth Platform". Under Branding, set the app name "Watchlist" and your support email. Under Audience choose "External", then "Publish app" (email and profile are non-sensitive scopes, so no Google review is needed).
  3. Under Clients, "Create client", type "Web application". Authorized JavaScript origin: `https://<domain>`. Authorized redirect URIs: `https://<domain>/api/auth/callback/google` and `http://localhost:3000/api/auth/callback/google`.
  4. Copy the Client ID and Client secret.
  5. In Vercel, Project, Settings, Environment Variables (Production), add `AUTH_GOOGLE_ID`, `AUTH_GOOGLE_SECRET`, `AUTH_SECRET` (generate with `npx auth secret` or any 32+ random bytes, base64), and `ALLOWED_EMAILS=wesley@vosk.co.za`. Leave `APP_PASSCODE` as it is.
  6. Tell Claude when done.
- [ ] **Step 7:** Only after Wesley confirms Step 6: `git checkout master && git merge --ff-only multi-user`, then `git push` as its own command.
  - Revert path: the `ListEntry` to `Title` FK is `ON DELETE RESTRICT`, so the old code's Remove fails with `P2003` against the migrated DB. If release 1 is reverted, first run (after reading it) `ALTER TABLE "ListEntry" DROP CONSTRAINT "ListEntry_titleId_fkey";`.
- [ ] **Step 8:** Wait for the Vercel deploy to be Ready (the build applies the migration). Run `npx tsx scripts/check-multi-user-migration.ts`. Expected: counts match, diff 0.
- [ ] **Step 9: Wesley's live checks**, in order: hard-reload; sign in from the installed iPhone PWA (spec section 14); confirm the list, a rating, a note and a pin look right; sign out and back in; try a non-allowlisted Google account and see the not-invited message. If PWA sign-in fails, stop and investigate before inviting anyone. Don't add, edit or remove titles while the release-1 deploy is building.
- [ ] **Step 10:** After a few days of solo use and Wesley's go-ahead, he adds friends' emails to `ALLOWED_EMAILS` and redeploys. From here release 1 is fix-forward only.

### Task 10: Release 2 cleanup (later, only on Wesley's go-ahead)

**Files:**
- Modify: `prisma/schema.prisma` (drop the seven personal columns from `Title`; optionally drop `RecommendationSet` and `DismissedTitle`)
- Create: `prisma/migrations/<timestamp>_drop_title_personal_columns/migration.sql`

- [ ] **Step 1:** Remove the columns, generate the migration schema-to-schema as in Task 1, and read it: only `DROP COLUMN`s (and `DROP TABLE`s if chosen).
- [ ] **Step 2:** `npx next build`, `npx tsc --noEmit`, `npx eslint`, `npx vitest run`, each separately. Expected: all pass with no code changes, since nothing reads those columns. Delete `scripts/check-multi-user-migration.ts` (it reads them).
- [ ] **Step 3:** Commit, push, confirm deploy Ready, then Wesley removes `APP_PASSCODE` from Vercel.
