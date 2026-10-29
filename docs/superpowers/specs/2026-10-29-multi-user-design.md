# Multi-User (Friends) Support: Design Spec

**Date:** 2026-10-29
**Status:** Draft (pending approval)
**Project location:** `C:\Users\Wesley Vos\dev\watchlist-app`

## 1. Purpose

Let a small group of friends (fewer than 10 people) use Watchlist, each with their own private list. Today the app has no concept of a user: one shared passcode unlocks one shared list. After this change each person signs in with Google and sees only their own Want and Watched lists, ratings, notes and pins.

Success looks like: Wesley adds a friend's Gmail address in Vercel, sends them the link, and they sign in, see an empty list, and start adding titles. Wesley's existing list is untouched and still his.

## 2. Goals

- Google sign-in is the only way into the app.
- Only email addresses on an allowlist can sign in.
- Each user has a private list. All list data (status, note, rating, pin, dates) is per user.
- Wesley's existing list moves to his account (`wesley@vosk.co.za`) with nothing lost: every status, note, rating, pin, `addedAt`, `watchedAt` and `pinnedAt` survives.
- Title metadata (TMDB data, OMDb scores, mood tags) is stored once and shared, so a title added by two people is fetched and mood-tagged once.
- Existing `/title/[id]` URLs keep working for Wesley (Title ids are preserved).

## 3. Non-goals

- Friends seeing each other's lists, or any social feature (shared lists, recommendations from friends, activity).
- An admin screen or invite links. Adding a friend means editing an env var and redeploying.
- Email/password or magic-link sign-in.
- Per-user API keys or per-user rate limiting. TMDB, OMDb and Gemini keys are shared; the volumes involved are far inside the free tiers.
- A "popular titles" onboarding experience.
- Account deletion or data export.

## 4. Anti-goals (failure even if it "works")

- One user can read, edit or delete another user's list entries by guessing or knowing an id.
- Wesley loses any existing list data, or ends up locked out of his own list after the switch.
- After signing out on a shared device, the next person sees the previous person's list, even briefly (from the localStorage list cache).
- A user's actions (refreshing, removing) change another user's list.

## 5. Decisions made by Wesley

| Topic | Decision |
|---|---|
| Sign-in method | Google sign-in. |
| Who can sign in | An allowlist of emails in a Vercel env var `ALLOWED_EMAILS` (comma separated, case-insensitive). Adding a friend = add their address and redeploy. |
| Owner of existing data | `wesley@vosk.co.za`. |
| Passcode | Removed entirely: the `/gate` page, `/api/auth` route, `wl_auth` cookie and `APP_PASSCODE` env var all go. |
| First visit for a new user | A simple empty state ("Your list is empty") with a button to search and add titles. |
| Visibility | Friends do not see each other's lists. |

## 6. Data model

Split today's `Title` into a shared catalog plus a per-user entry.

**`User`** (new): `id`, `email` (unique, stored lowercase), `name?`, `image?`, `createdAt`.

**`Title`** (existing, becomes the shared catalog): keeps every metadata field (TMDB fields, scores, `moods`, `moodsTaggedAt`, `fetchedAt`, etc.) and its `@@unique([tmdbId, mediaType])`. The personal fields (`status`, `note`, `myRating`, `pinned`, `pinnedAt`, `addedAt`, `watchedAt`) stop being read or written in release 1 and are dropped in release 2.

**`ListEntry`** (new): `id`, `userId`, `titleId`, `status` (WANT/WATCHED, default WANT), `note?`, `myRating?`, `pinned` (default false), `pinnedAt?`, `addedAt` (default now), `watchedAt?`. Unique on `(userId, titleId)`. Indexed for the list queries (by `userId` + `status`).

Existing behaviour rules move with the fields unchanged: setting status to WATCHED sets `watchedAt` and unpins; list ordering (pinned first then `pinnedAt`/`addedAt` for Want; `watchedAt` then `addedAt` for Watched) is the same, now ordered by entry columns.

**Removing a title** deletes the user's `ListEntry` only. The shared `Title` row stays (orphan catalog rows are harmless and make a re-add instant).

## 7. Migration and rollout

Two releases, so the switch can be undone.

**Release 1 (additive):**
- Migration creates `User` and `ListEntry`, inserts the user `wesley@vosk.co.za`, and copies every existing `Title` row's personal fields into a `ListEntry` for that user, preserving all dates. No columns are dropped.
- The app switches to Google sign-in and reads/writes only `ListEntry` for personal data.
- If release 1 has to be reverted, the old columns on `Title` still hold Wesley's data as of the cutover (changes made after cutover would not be reflected; acceptable).

**Revert window and staged rollout (Claude's call, flagged for Wesley):** a revert is only clean **before any friend has signed in**. Once friends add titles, the old code would show every catalog row (including friends' titles, which carry the default `status = WANT`) on Wesley's list, and the old Remove would delete shared rows. So rollout is staged:
1. Ship release 1 with `ALLOWED_EMAILS` containing only `wesley@vosk.co.za`. Wesley uses it alone for a few days, including the iOS PWA check in section 14.
2. Once happy, add friends' emails and redeploy. From this point release 1 is not reverted; problems are fixed forward.

Supporting rules:
- `APP_PASSCODE` stays set in Vercel until release 2. The old middleware fails closed without it, so removing it early would lock Wesley out on a revert. The new code simply ignores it.
- The `ListEntry -> Title` foreign key uses **on delete restrict**. New code never deletes `Title` rows, and restrict means no stray code path can ever take other users' entries with it. `ListEntry -> User` cascades.

**Release 2 (destructive, later, after release 1 has been used for a while):** drop the personal columns from `Title`. This follows the existing rule that a feature change never carries a destructive migration. (Dropping the retained `RecommendationSet` and `DismissedTitle` tables can ride along or stay separate; builder's call.)

**Lockout prevention:** before release 1 is pushed, Wesley creates the Google OAuth client and sets all new env vars in Vercel (the plan must give click-by-click steps for Google Cloud Console, including the production redirect URI). Release 1 must not be pushed until those are confirmed set.

Migrations are generated with `prisma migrate diff ... --script` per AGENTS.md, never `migrate dev`.

## 8. Authentication

- Google sign-in with a JWT session cookie (no database session tables needed). The sign-in callback rejects any email not in `ALLOWED_EMAILS` and, for allowed emails, upserts the `User` row. Sessions are long-lived (about a year, matching today's "remember this device").
- The allowlist is re-checked on every authenticated request, not only at sign-in, so removing a friend's email and redeploying signs them out even though their session cookie is long-lived. (Claude's call.)
- A rejected sign-in lands on a friendly "You're not on the invite list. Ask Wesley to add you." page.
- Next.js 16 renamed Middleware to **Proxy** (`src/proxy.ts`); the existing `src/middleware.ts` is replaced accordingly. Per the Next docs, Proxy does only the optimistic "is there a session?" redirect. **Real authorization happens in each route handler and server page**, which must load the current user and scope every query by `userId`.
- Unauthenticated page requests redirect to a sign-in page; unauthenticated API requests return 401. The PWA manifest, icons and static assets stay public.
- Library choice is the builder's, Auth.js (NextAuth v5) being the expected default. The builder must confirm it supports Next 16.2 / React 19.2 before planning around it, and read `node_modules/next/dist/docs/01-app/02-guides/authentication.md`.

## 9. Scoping every read and write

Every place that touches personal data takes the current user and filters by it. Known call sites:

- `src/lib/titles.ts`: `listTitles`, `getTitle`, `updateTitle`, `deleteTitle`, and the add/upsert path (upsert the shared `Title`, then create the user's `ListEntry`).
- `src/app/api/titles/route.ts` (GET, POST), `src/app/api/titles/[id]/route.ts` (PATCH, DELETE), `src/app/api/titles/[id]/refresh/route.ts`.
- `src/app/title/[id]/page.tsx`: if the signed-in user has no entry for this title, redirect to `/preview/[mediaType]/[tmdbId]` rather than showing someone else's data.
- `src/app/api/search/route.ts`: "already on your list" markers come from the user's entries only.
- `src/app/mood/page.tsx` and `src/app/mood/[slug]/page.tsx`: counts and grids include only titles on the signed-in user's Want list.

**Ownership rule:** an id in a URL is never trusted on its own. A PATCH/DELETE for a title the user has no entry for returns 404 (not 403, to avoid confirming the id exists).

**Refresh** re-fetches shared metadata. Any user with the title on their list may refresh it; it updates the shared row for everyone, which is correct because the data is the same for everyone.

**Mood tagging** stays as is: tagging is per title, not per user, so it happens once regardless of how many people add the title.

## 10. Client-side cache

- `src/lib/listPersist.ts` writes the list to localStorage under one fixed key. The key must include the user id, so one user's cached list can never seed another user's screen.
- Signing out clears that user's persisted list and does a full page load, so the module-level `listCache` and `searchCache` are also reset.

## 11. UI changes

- Sign-in page: app name/icon and a "Sign in with Google" button. Replaces `/gate`.
- Not-invited page (see section 8).
- Empty state on the home Want and Watched tabs when the user has no entries: short message plus a button to the search page.
- A small sign-out control near the top of the home screen, showing who is signed in (avatar or first name). Placement and styling are the builder's call, consistent with the existing design.

## 12. Scripts

The scripts in `scripts/` read `Title.status` and must be updated in release 1:

- `tag-all-moods.ts`, `clear-want-moods.ts`: "Want" now means "on anyone's Want list" (an entry with status WANT exists).
- `import-google-takeout.ts`: requires a target user (for example `--email`) and writes `ListEntry` rows for that user.
- `refresh-all-titles.ts`: also filters on `Title.status` today; switch it to "on anyone's Want list" like the others.

## 13. Environment variables

Added: `ALLOWED_EMAILS`, the Google OAuth client id and secret, and the session secret the auth library needs (exact names per the library). Removed from code: `APP_PASSCODE` (but it stays set in Vercel until release 2; see section 7). `src/lib/env.ts` and `.env.example`/README are updated to match.

## 14. Known risk to check early

**iOS home-screen PWA and Google sign-in.** In standalone PWA mode on iOS, the Google redirect can open in a separate browser sheet, and the session cookie may land there instead of in the PWA. Wesley should test sign-in from the installed PWA on his phone as the first live check after release 1. If it fails, the fallback is to document "sign in once in Safari, then install", or adjust the flow; the builder should research the current behaviour before implementing.

## 15. Testing

- Replace `src/app/api/__tests__/auth.test.ts` and `src/__tests__/middleware.test.ts` with tests for the allowlist check and the proxy redirect/401 behaviour.
- Ownership tests: user B gets 404 on PATCH/DELETE/refresh of user A's entry; user B's list, search markers and mood counts never include user A's entries.
- Data tests: adding a title already in the catalog creates only a `ListEntry` and triggers no fetch or tagging; removing deletes only the entry.
- Migration check: after release 1's migration on a copy of the data, the count of Wesley's entries equals the count of `Title` rows, and spot-checked notes/ratings/dates match.
- Existing tests are updated to the new model and must all pass, along with `tsc`, `eslint` and `next build`, per AGENTS.md.

## 16. Left to the builder

- Auth library and its configuration details (subject to section 8).
- Exact env var names, page copy, and the visual design of the sign-in, not-invited and empty-state screens.
- Whether `/title/[id]` keeps using `Title.id` (expected: yes, so existing URLs survive).
- Whether release 2 also drops `RecommendationSet` and `DismissedTitle`.
