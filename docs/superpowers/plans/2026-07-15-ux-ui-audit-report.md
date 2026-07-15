# UX/UI Audit: Implementation Report

> Companion to [2026-07-15-ux-ui-audit.md](./2026-07-15-ux-ui-audit.md). Covers all 7 phases; every item was implemented and verified (lint, `tsc --noEmit`, `next build`, plus live checks against the running app / real DB) except 7.2, which is blocked on a dependency decision.

**Files touched:** `public/manifest.webmanifest`, `next.config.ts` (unchanged — no config needed), `src/app/layout.tsx`, `src/app/globals.css`, `src/app/gate/page.tsx`, `src/app/page.tsx`, `src/app/search/page.tsx`, `src/app/api/search/route.ts`, `src/app/title/[id]/TitleDetail.tsx`, `src/lib/types.ts`, `src/components/ListToggle.tsx`, `src/components/TitleCard.tsx`, `src/components/BackLink.tsx` (new).

---

## 1. Foundation

| # | Item | What changed |
|---|------|--------------|
| 1.1 | Mono-metadata signature only on one screen | Added shared `.meta` utility (`font-mono text-[11px] uppercase tracking-wide text-gray-500`) in `globals.css`; applied to `TitleCard`, `TitleDetail` header/rating labels, and search page (unifying a drifted `text-xs` count line). |
| 1.2 | iOS zoom on small inputs | Search input and note textarea now `text-base sm:text-sm` (16px on mobile). |
| 1.3 | No safe-area handling | Added `viewportFit: "cover"` to the viewport export; `body` gets `padding-top/bottom: env(safe-area-inset-*)`. |
| 1.4 | White launch flash in dark mode | `manifest.webmanifest` `background_color` changed `#ffffff` → `#0a0a0a`. |
| 1.5 | No press feedback / gray tap flash | `-webkit-tap-highlight-color: transparent` on `html`; added `active:` states in the existing hover vocabulary to every button/link app-wide (including the home "+ Add" link, which had no states at all). |
| 1.6 | Poster cards have no focus ring | `TitleCard`'s link gets `focus-visible:ring-2 ring-foreground` plus `active:opacity-90`. |

## 2. Gate

| # | Item | What changed |
|---|------|--------------|
| 2.1 | No identity | Added a mono eyebrow "Private library" above the wordmark. |
| 2.2 | No pending state / silent network failure | Added `busy` state (button disables, reads "Checking…"); try/catch distinguishes "Can't reach the server" from "Incorrect passcode". |
| 2.3 | Missing form semantics | Added `aria-label="Passcode"` and `autoComplete="current-password"`. |

## 3. Home

| # | Item | What changed |
|---|------|--------------|
| 3.1 | Bare "Loading…" text | 6-block pulsing skeleton grid matching the real layout. |
| 3.2 | Identical, inert empty states | Per-tab copy: WANT gets a "Search titles" link into `/search`; WATCHED explains titles arrive there automatically. |
| 3.3 | Fetch errors read as empty | Added `error` state distinct from empty; honest "Couldn't load your list." + Retry, never a false empty claim. |
| 3.4 | Tab switch blanks the list | Per-status cache (`Record<Status, ListState>`); cached grid shown instantly on switch, revalidated silently in the background. |
| 3.5 | Primary action in the worst thumb spot | Added a fixed bottom-left circular FAB (`+`, 56px, respects `safe-area-inset-bottom`); kept the top-right link as a secondary affordance. |
| 3.6 | No counts anywhere | `ListToggle` now shows a mono count per segment; both lists are fetched on mount so both counts are ready immediately. |
| 3.7 | Sort order invisible | Mono caption above the grid ("By date added" / "By date watched"), matching the actual `orderBy` in `src/lib/titles.ts`. |

## 4. Search

| # | Item | What changed |
|---|------|--------------|
| 4.1 | Add buttons too small/close | Buttons (and the new library badge) grew to `h-11` (44px) with `gap-2.5`. |
| 4.2 | Adding ejects you from results | Add no longer navigates away; the row flips to a quiet "On list"/"Watched" badge-link, so multi-add stays on the results. |
| 4.3 | Search state lost on navigation | Query syncs to `/search?q=...` via `router.replace`; an isolated `UrlQuerySync` component (its own `<Suspense>`) restores it on load/Back/Forward without bailing the whole page to client-only rendering. |
| 4.4 | No "already in library" indicator | `/api/search` now cross-references TMDb results against the DB and returns `library: {id, status} \| null` per result; verified live that an already-owned title comes back correctly matched. |
| 4.5 | 32px back button | Grew to `h-11 w-11` (44px) with a `-ml-2.5` compensating margin. |

## 5. Title detail

All 11 items implemented in one pass, since they touch the same file:

- **5.1** Extracted a shared `BackLink` component (used by both search and detail) — the exact 44px chevron pattern, one source of truth.
- **5.2** Genre pills, rating-tile values, and the year/runtime line use the mono signature; "Director" is now a mono eyebrow over the name.
- **5.3** Transient "Saved"/"Updated" mono caption (fade via new `.flash-caption` animation) beside rating, note-save, and Refresh.
- **5.4** `confirm()` replaced with inline two-step confirm ("Tap again to remove", reverts after 4s).
- **5.5** Number-spinner input replaced with an 11-glyph (0–10) mono tap-to-rate row; tap active value to clear; auto-saves.
- **5.6** Mono "Data from N days ago" caption above the actions, using the already-present `fetchedAt` field.
- **5.7** "Watched 15 July 2026"-style mono caption on watched titles, using the already-present `watchedAt` field.
- **5.8** Error text gets `dark:text-red-400`, matching `tasks/lessons.md`'s established token rule.
- **5.9** Toggle-status and Remove now both respect the shared `saving` flag, preventing interleaved mutations.
- **5.10** "Save note" disabled unless the note differs from the persisted value; re-disables automatically after save.
- **5.11** Cast list shows first 6 with a quiet "All 15" mono expand/collapse toggle.

## 6. Components

| # | Item | What changed |
|---|------|--------------|
| 6.1 | No toggle semantics | `ListToggle` wrapper gets `role="group" aria-label="Filter by list"`; each segment gets `aria-pressed`. |
| 6.2 | Active segment jumps | Replaced the per-button background swap with one absolutely-positioned sliding thumb (`translate-x-0` / `translate-x-full`, `transition-transform`, `motion-reduce` respected via the global rule from 7.1). |
| 6.3 | Segments ~36px tall | Padding changed `p-2` → `px-2 py-3`, reaching the full 44px target. |
| 6.4 | Poster fallback typography | Fallback title now uses `.meta` instead of plain `text-xs text-gray-500` — zero new elements, as proposed. |

## 7. Cross-cutting

| # | Item | Status | Notes |
|---|------|--------|-------|
| 7.1 | No motion system | **Done** | One rule app-wide via Tailwind v4 theme variables: `--default-transition-duration: 180ms`, `--default-transition-timing-function: var(--ease-out)` — every bare `transition-*` utility already in use picks this up with zero per-element edits. Global `prefers-reduced-motion: reduce` rule kills all transitions/animations in one place. New `.fade-in` (opacity + 4px translateY, 200ms) applied to the home grid, search results, and the detail page. |
| 7.2 | Poster continuity (list → detail) | **Skipped (decision)** | Verified per the audit's own instruction: Next 16.2.10 documents `experimental.viewTransition` + React's `<ViewTransition>`, but the installed `react`/`react-dom` (19.2.4 stable) don't export `ViewTransition` at all, and no canary/experimental subpath is present. Upgrading React to canary for this alone was judged not worth the dependency risk on a live app. Left as a plain cut; revisit if/when React ships this in a stable release. |
| 7.3 | No reload inside installed app | **Done** | `visibilitychange` listener on the home page silently revalidates the active list when the PWA resumes from background, on top of the 3.3 retry buttons. Full pull-to-refresh was intentionally skipped per the audit's own call ("likely over-engineering"). |
| 7.4 | Add flow round-trip cost | **N/A — no code** | Bookkeeping item only; already resolved by 3.5 + 4.1 + 4.2, all implemented above. |

---

## Verification performed

- `npx eslint` and `npx tsc --noEmit` after every change set — all clean.
- `npx next build` after every change set — all clean, `/search` confirmed still static (no `BAILOUT_TO_CLIENT_SIDE_RENDERING` outside the isolated `UrlQuerySync` piece).
- Live checks against the running app and the real Neon DB: authenticated via `/api/auth`, confirmed API contracts (`/api/search`'s new `library` field, `/api/titles` counts), and confirmed server-rendered markup for new UI (skeletons, FAB, 44px targets, mono captions, watched-date formatting).
- Not verified: full interactive click-through (tab switching, retry, remove-confirm double-tap) in a real browser — this project has no Playwright/Puppeteer installed, and one wasn't added solely for verification. Static analysis + SSR/API checks give strong but not complete confidence; a manual pass is worth doing before shipping.

## Manual QA priority

Everything passed lint/typecheck/build, and the pieces I could hit with `curl` (SSR markup, API contracts against the real DB) checked out. But real client-side behavior — timing, state transitions, visual alignment — was reasoned through rather than watched happen, since this session had no Playwright/Puppeteer. Ranked by where a real bug is most likely to be hiding:

1. **Home page fetch/cache state machine** (`src/app/page.tsx`) — the highest-complexity piece of client logic touched this session: two `useEffect`s (mount-fetch-both, status-switch-revalidate) coordinated via a `skipNextStatusFetch` ref, plus a `visibilitychange` listener (7.3) and a `reloadToken` retry counter, all mutating one `Record<Status, ListState>`. This is exactly the shape of code that behaves differently under React Strict Mode's double-invoke than in a single pass, and I never actually watched it run in a browser. **Click through:** switch tabs back and forth rapidly, background the tab and return, and hit Retry on a simulated failure (throttle network) — watch for double-fetches, a stuck skeleton, or counts going stale.

2. **Title detail's shared `saving` flag** (`TitleDetail.tsx`, items 5.5 + 5.9) — every mutation (rating tap, note save, refresh, toggle, remove) shares one `saving` boolean, so tapping a single rating number now visibly disables Refresh/Remove/toggle-status too for the round-trip duration. That's correct for preventing interleaved writes, but it cuts against 5.5's intent of the rating row feeling instant and light. **Click through:** tap a rating and watch whether the rest of the action row visibly dimming/locking feels like a hiccup rather than a save confirmation.

3. **Search URL sync** (`search/page.tsx`, item 4.3) — the `UrlQuerySync` child + `searchedForRef` dedup guard is the trickiest piece of new logic in this pass, designed specifically to avoid an infinite loop between `router.replace` and `useSearchParams`. I confirmed it builds and doesn't bail SSR, but never manually searched, hit Back, and confirmed the query and results actually restore. **Click through:** search, add a title, use the browser Back button, and confirm the original query/results reappear rather than a blank search screen.

4. **`ListToggle` sliding thumb alignment** (item 6.2) — confirmed the right CSS classes render, but never visually confirmed the thumb lines up pixel-perfectly under each label (rounded corners, the `p-1` track padding, and per-segment count badges shifting label width could all throw off the eyeballed alignment). **Click through:** toggle between tabs and watch the thumb land squarely under the label at both viewport widths (mobile + desktop).

5. **Home FAB renders on every branch** — the new bottom-left "+" FAB (3.5) is placed outside the skeleton/error/empty/grid conditional, so it's always on screen, including stacked with the WANT tab's empty-state "Search titles" button. Both are correct individually but I never checked whether they visually crowd each other on a short viewport. **Click through:** view the empty WANT state on a small screen.

6. **Note re-disable after save** (item 5.10) — the Save-note button re-disables by comparing local `note` state against the `title.note` prop, which only updates once `router.refresh()` delivers fresh server data. If Next's route-segment caching ever serves a stale response to that refresh, the button would stay enabled after a successful save. **Click through:** edit a note, save it, and confirm the button greys out without needing a manual page reload.

None of these are things I'd bet are broken — they're the spots where volume, not confidence, is the reason they got less scrutiny than the rest.
