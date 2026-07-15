# UX/UI Audit: Full App Pass

> **Purpose:** Identification-only wishlist covering every page, component, and workflow. No code was changed for this pass. Each item cites the file and current code. A later session picks items from here to implement.
>
> **Identity ground rules for every proposal below:** monochrome system (`bg-foreground` / `bg-background` tokens, hairline `black/10` and `white/10` borders), restrained editorial tone, and the mono-metadata signature established on the search screen (`font-mono text-[11px] uppercase tracking-wide text-gray-500`, see `src/app/search/page.tsx:119` and `:134`). "Delight" means quiet, deliberate touches in that language. Nothing bouncy, nothing that reads as a different app.
>
> **Mobile context:** installed PWA, one-handed use, left-handed user. Left thumb rests bottom-left; top-right is the hardest zone to reach. Comfortable touch targets are 44px+.

---

## 1. Foundation (layout, globals, manifest)

### 1.1 The mono-metadata signature only exists on one screen
- **Where:** `src/components/TitleCard.tsx:25-27`, `src/app/title/[id]/TitleDetail.tsx:102-104`, vs `src/app/search/page.tsx:119,134`
- **Current state:** Search result metadata and the results count use the mono signature. The home card metadata line (`{year} · ★ 8/10`) and the detail header line (`{year} · {runtime} min`) are plain sans `text-gray-500`. The app's one typographic idea is confined to one screen.
- **Proposed improvement:** Systematize the signature. Extract one shared class or tiny component (e.g. a `meta` utility: `font-mono text-[11px] uppercase tracking-wide text-gray-500`) and apply it to: TitleCard metadata line, detail header year/runtime line, rating tile labels, and any counts. Numbers throughout get mono's tabular figures for free.
- **Category:** typography
- **Effort:** quick win (mechanical class swaps across 3 files)

### 1.2 iOS zooms the viewport when focusing small inputs
- **Where:** `src/app/search/page.tsx:88` (search input, `text-sm`), `src/app/title/[id]/TitleDetail.tsx:157` (note textarea, `text-sm`)
- **Current state:** Inputs with font-size below 16px trigger the iOS Safari auto-zoom on focus, including in standalone PWAs. The search input and note textarea are 14px. The gate input (`src/app/gate/page.tsx:27`) is fine at default 16px.
- **Proposed improvement:** Set 16px font on all text inputs (`text-base` on mobile, `sm:text-sm` if the smaller size is wanted on desktop).
- **Category:** accessibility
- **Effort:** quick win

### 1.3 No safe-area handling for standalone iOS
- **Where:** `src/app/layout.tsx:26-30` (viewport export), all page `main` elements
- **Current state:** `appleWebApp.statusBarStyle` is `black-translucent`, which lets content scroll underneath the iOS status bar, but the viewport export has no `viewportFit: "cover"` and no page pads with `env(safe-area-inset-*)`. On a notched phone the header row can sit under the clock/notch, and bottom content can collide with the home indicator.
- **Proposed improvement:** Add `viewportFit: "cover"` and apply safe-area padding at the layout level (e.g. `padding-top: env(safe-area-inset-top)` on body or a header wrapper, and include `env(safe-area-inset-bottom)` in the bottom padding).
- **Category:** spacing
- **Effort:** moderate (needs on-device verification)

### 1.4 White launch flash in dark mode
- **Where:** `public/manifest.webmanifest:6`
- **Current state:** `background_color` is `#ffffff`. A dark-mode user launching the installed app gets a white splash before `#0a0a0a` paints.
- **Proposed improvement:** The manifest can't follow the system theme, so pick the lesser evil. Given the black `theme_color` and the app's monochrome identity, `#0a0a0a` as splash reads as intentional in both modes; white-on-launch in dark mode reads as a bug. Decide and document the tradeoff.
- **Category:** state (launch)
- **Effort:** quick win

### 1.5 No press feedback, default gray tap flash
- **Where:** all interactive elements; e.g. `src/components/TitleCard.tsx:13`, buttons across pages
- **Current state:** Hover states exist (`hover:opacity-90`, `hover:bg-gray-100`) but hover does not exist on touch. On iOS the only tap feedback is the default gray tap-highlight rectangle, which clashes with the monochrome aesthetic.
- **Proposed improvement:** Suppress the default tap highlight (`-webkit-tap-highlight-color: transparent` in globals) and add quiet `active:` states in the same vocabulary as the hovers: `active:opacity-80` on filled buttons, `active:bg-gray-100 dark:active:bg-white/10` on outlined ones, `active:opacity-90` on poster cards. Opacity only, no scale, no spring.
- **Category:** micro-interaction
- **Effort:** quick win

### 1.6 Poster cards have no visible keyboard focus
- **Where:** `src/components/TitleCard.tsx:13`
- **Current state:** The card `Link` has no `focus-visible` styles, while every button in the app has the established `focus-visible:ring-2 ring-foreground` treatment.
- **Proposed improvement:** Add the same ring treatment (`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground rounded-lg`) to the card link.
- **Category:** accessibility
- **Effort:** quick win

---

## 2. Gate (`src/app/gate/page.tsx`)

### 2.1 The front door carries no identity
- **Where:** `src/app/gate/page.tsx:20-32`
- **Current state:** Centered "Watchlist" h1, a password field, an Enter button. Functional, but the first screen of the app has none of the editorial voice.
- **Proposed improvement:** One quiet touch, not a redesign: a mono eyebrow above the wordmark (e.g. `PRIVATE LIBRARY` in the signature style), which also explains to a first-time viewer why there's a passcode at all. Copy does the work; no imagery needed.
- **Category:** typography
- **Effort:** quick win

### 2.2 Submit has no pending state and network failure is silent
- **Where:** `src/app/gate/page.tsx:10-16`
- **Current state:** `submit` awaits `fetch` with no busy flag, so the button stays active (double-submit possible) and there is zero feedback while the request runs. If the fetch throws (offline, server down), the rejection is unhandled and the user sees nothing at all.
- **Proposed improvement:** Disable the button and show a pending label while submitting; wrap in try/catch and show a distinct message for network failure ("Can't reach the server. Check your connection.") vs wrong passcode.
- **Category:** state (loading, error)
- **Effort:** quick win

### 2.3 Passcode input missing form semantics
- **Where:** `src/app/gate/page.tsx:22-29`
- **Current state:** Placeholder-only field, no `aria-label`, no `autocomplete="current-password"`, so password managers and screen readers both work worse than they should.
- **Proposed improvement:** Add `aria-label="Passcode"` and `autocomplete="current-password"`.
- **Category:** accessibility
- **Effort:** quick win

---

## 3. Home (`src/app/page.tsx`)

### 3.1 Loading state is bare text while search has skeletons
- **Where:** `src/app/page.tsx:37`
- **Current state:** `Loading…` centered text. Search already established the app's skeleton pattern (pulsing blocks, `motion-reduce:animate-none`, `src/app/search/page.tsx:103-114`). The home screen, the most-visited screen, has the weakest loading state, and the layout jumps from a text line to a poster grid.
- **Proposed improvement:** A skeleton poster grid matching the real layout: 6 pulsing `aspect-[2/3]` blocks in the same 3-column grid, using the established skeleton classes. No layout shift when content lands.
- **Category:** state (loading)
- **Effort:** quick win

### 3.2 Empty states are identical, inert, and tab-blind
- **Where:** `src/app/page.tsx:39`
- **Current state:** Both tabs show "Nothing here yet." with nothing to do next. Search's empty state (illustration + invitation + next step) already set a better standard.
- **Proposed improvement:** Per-tab copy with an action. WANT empty: "Nothing on your list. Find something to watch." with a link to `/search`. WATCHED empty: "Nothing watched yet. Titles move here when you mark them watched." An empty screen is an invitation to act; the WANT one especially should hand you the next step.
- **Category:** state (empty)
- **Effort:** quick win

### 3.3 Fetch errors masquerade as an empty list
- **Where:** `src/app/page.tsx:16-23`
- **Current state:** The fetch chain has no `.catch`. On network failure or a non-OK response, the rejection is unhandled, `titles` stays `[]`, and the UI confidently shows "Nothing here yet.", which is false and alarming (a user with 50 titles briefly believes their library is gone).
- **Proposed improvement:** Catch failures into an error state with honest copy and a retry: "Couldn't load your list. Retry." Never render the empty state on error.
- **Category:** state (error)
- **Effort:** quick win

### 3.4 Tab switching blanks the list every time
- **Where:** `src/app/page.tsx:12-27`
- **Current state:** Every toggle between Want/Watched refetches and replaces the grid with the loading state, even for a list fetched two seconds ago. Feels like a page reload, not a toggle.
- **Proposed improvement:** Cache per-status results in state (keyed by status) and revalidate in the background: show the cached grid instantly on toggle, refresh silently. The toggle then feels like flipping a card, which matches how light this app should feel.
- **Category:** state / micro-interaction
- **Effort:** moderate

### 3.5 The primary action lives in the worst spot for a left thumb
- **Where:** `src/app/page.tsx:33`
- **Current state:** "+ Add" is top-right, the single hardest zone for one-handed left-hand use, and at `px-3 py-2 text-sm` it is roughly 36px tall. Meanwhile every page already reserves `pb-24` of bottom padding that nothing uses.
- **Proposed improvement:** Move the primary add affordance into the thumb zone: a fixed bottom-left circular or pill "+ Add" (bottom-left specifically because the user is left-handed), styled in the existing vocabulary (`bg-foreground text-background`, no shadow theatrics), respecting `safe-area-inset-bottom`. The `pb-24` already anticipates this. Keep a smaller top link if desired for discoverability.
- **Category:** information hierarchy / touch
- **Effort:** moderate

### 3.6 No counts anywhere
- **Where:** `src/app/page.tsx:32-35`, `src/components/ListToggle.tsx`
- **Current state:** Nothing tells you the size of either list. The search screen already shows "N RESULTS" in mono; the home screen, which is the library, shows no count at all.
- **Proposed improvement:** A mono count in the signature style, either inside each toggle segment ("Want to watch 12") or as a single caption line under the header ("23 TITLES"). Doubles as reassurance that the library loaded.
- **Category:** information hierarchy
- **Effort:** moderate (needs counts for both lists, so pairs naturally with 3.4's fetch-both approach)

### 3.7 Sort order is invisible
- **Where:** `src/lib/titles.ts:53-59`, rendered at `src/app/page.tsx:41-43`
- **Current state:** Want sorts by most recently added, Watched by most recently watched. Sensible defaults, but nothing communicates them; the grid is just an unlabeled wall of posters.
- **Proposed improvement:** Lowest-key fix: a mono caption above the grid ("BY DATE ADDED" / "BY DATE WATCHED") in the signature style. It labels the structure honestly and adds another beat of the mono voice. An actual sort control is out of scope for this app's restraint unless the library grows.
- **Category:** information hierarchy
- **Effort:** quick win

---

## 4. Search (`src/app/search/page.tsx`)

### 4.1 The two add buttons are small and adjacent
- **Where:** `src/app/search/page.tsx:138-147`
- **Current state:** "+ Want" and "+ Watched" are `py-1.5 text-xs`, roughly 30px tall, stacked with a 6px gap. Two different destructive-of-intent actions within a few millimetres of each other is a mis-tap trap on a phone.
- **Proposed improvement:** Raise each to a 44px effective hit area (larger padding, or padding + negative margin to keep the visual size) and widen the gap slightly. Alternative worth considering: one primary "+ Want" button per row and a long-press or secondary affordance for "Watched", since adding-to-want is the dominant flow when searching for something new.
- **Category:** touch / accessibility
- **Effort:** quick win (sizing) / moderate (single-action rethink)

### 4.2 Adding a title ejects you from the results
- **Where:** `src/app/search/page.tsx:48-51`
- **Current state:** A successful add navigates straight to the new title's detail page. Adding three titles from one search means three full round trips, and since results live only in component state, Back returns to an empty search screen and you retype the query each time.
- **Proposed improvement:** Stay on the results after adding. The added row flips its buttons to a quiet mono "ADDED" with a small "View" link, so multi-add becomes the natural flow. Detail is one tap away for those who want it.
- **Category:** micro-interaction / workflow
- **Effort:** moderate

### 4.3 Search state is lost on any navigation
- **Where:** `src/app/search/page.tsx:9-13`
- **Current state:** Query and results are component state only; nothing syncs to the URL. Back/forward, a refresh, or the post-add redirect all wipe the search.
- **Proposed improvement:** Mirror the query into the URL (`/search?q=dune`) and re-run the search on mount when `q` is present. Back then restores what you were looking at. Complements 4.2; either alone fixes most of the pain.
- **Category:** state
- **Effort:** moderate

### 4.4 No indication a result is already in your library
- **Where:** `src/app/search/page.tsx:122-150`
- **Current state:** Results show no ownership state. Searching for something you added last month presents identical "+ Want / + Watched" buttons and no signal, so you can second-guess or re-add.
- **Proposed improvement:** Mark rows already in the library with a mono badge in the signature style ("ON LIST" / "WATCHED") that links to the title, replacing the add buttons. Needs the search endpoint (or a follow-up lookup) to return matching library ids.
- **Category:** information hierarchy
- **Effort:** larger (API change + UI)

### 4.5 Back button hit area is 32px
- **Where:** `src/app/search/page.tsx:64-72`
- **Current state:** The chevron is `h-8 w-8` (32px), below the 44px comfort floor, and it is the row's only navigation.
- **Proposed improvement:** Grow the hit area to 44px (`h-11 w-11` with a compensating negative margin so the optics stay light).
- **Category:** touch
- **Effort:** quick win

---

## 5. Title detail (`src/app/title/[id]/TitleDetail.tsx`)

### 5.1 Back navigation is inconsistent with search and tiny
- **Where:** `src/app/title/[id]/TitleDetail.tsx:93`
- **Current state:** A bare `← Back` text link, `text-sm`, far under 44px tall. Search established a proper chevron icon button with hover/focus states; detail regressed to plain text.
- **Proposed improvement:** Reuse the exact chevron button pattern from search (one shared component would prevent future drift), sized per 4.5.
- **Category:** touch / consistency
- **Effort:** quick win

### 5.2 Metadata and labels ignore the mono signature
- **Where:** `src/app/title/[id]/TitleDetail.tsx:102-104` (year · runtime), `:105` (Director), `:107-109` (genre pills), `:18` (rating tile labels)
- **Current state:** All plain sans. This is the most metadata-dense screen in the app, exactly where the mono signature earns its keep, and it is absent.
- **Proposed improvement:** Apply the signature to the year/runtime line, the rating tile labels (TMDB / IMDB / RT / META in mono uppercase), and the genre pills (mono `text-[11px]` uppercase). "Director" reads better as a mono eyebrow over the name than as inline "Director: X". Rating values pick up tabular mono numerals (pairs with 1.1).
- **Category:** typography
- **Effort:** quick win

### 5.3 Saving is silent
- **Where:** `src/app/title/[id]/TitleDetail.tsx:32-49` (patch), buttons at `:123-126`, `:160-162`
- **Current state:** A successful save calls `router.refresh()` and nothing visibly changes. No confirmation that the rating or note persisted; the only feedback the save system ever gives is an error.
- **Proposed improvement:** A transient mono "SAVED" caption beside the button (appear, hold ~1.5s, fade), in the signature style. This is precisely the kind of quiet delight the identity calls for. Same treatment after Refresh ("UPDATED").
- **Category:** micro-interaction
- **Effort:** quick win

### 5.4 Remove uses the native confirm() dialog
- **Where:** `src/app/title/[id]/TitleDetail.tsx:77`
- **Current state:** `confirm("Remove this title?")` throws a browser-chrome dialog over the app. It is the single most off-brand moment in the product.
- **Proposed improvement:** Inline two-step confirm: first tap turns the button into "Tap again to remove" (still in the quiet red outline treatment), reverting after a few seconds. No overlay, no native chrome. Keep Remove as the right-most action: for a left-handed user that keeps the destructive control farthest from the resting thumb, which the current layout already gets right; preserve it.
- **Category:** micro-interaction
- **Effort:** moderate

### 5.5 My rating is a spinner-arrow number input
- **Where:** `src/app/title/[id]/TitleDetail.tsx:118-126`
- **Current state:** `type="number" min={0} max={10}`, a 20px-wide box with desktop spinner arrows, no `inputMode`, and typing "11" is not blocked (min/max only constrain the spinners). Plus an explicit Save button. For the field the plan calls "the key personal field", the interaction is the clumsiest on the page.
- **Proposed improvement:** Replace with a tap-to-rate row: the numerals 1-10 set in mono, tap to set, tap the current value to clear, auto-saving on tap (with 5.3's SAVED confirmation). A row of eleven mono glyphs is very much this app's language, kills the keyboard entirely, and removes a Save button.
- **Category:** micro-interaction / workflow
- **Effort:** moderate

### 5.6 fetchedAt exists but the Refresh button has no context
- **Where:** `src/app/title/[id]/TitleDetail.tsx:172`; data available server-side (`src/lib/titles.ts` model, used by `isStale`)
- **Current state:** A bare "Refresh" button. Nothing says when the external data was last fetched, so the user cannot judge whether refreshing is worthwhile. `fetchedAt` is on the model but not passed to the client component.
- **Proposed improvement:** Pass `fetchedAt` through and render a mono caption near the actions: "DATA FROM 12 DAYS AGO". The Refresh button then has a reason to exist on screen.
- **Category:** information hierarchy
- **Effort:** moderate

### 5.7 watchedAt is captured but never shown
- **Where:** model field used at `src/lib/titles.ts:58`; absent from `TitleDetail.tsx` interface
- **Current state:** The app records when you watched something (it even sorts the Watched tab by it) but never displays it anywhere.
- **Proposed improvement:** On watched titles, a mono caption in the header block: "WATCHED 3 MAY 2026". For a personal log, this is the single most personal datum the app holds and it is currently invisible.
- **Category:** information hierarchy
- **Effort:** moderate

### 5.8 Error message missing its dark-mode variant
- **Where:** `src/app/title/[id]/TitleDetail.tsx:165`
- **Current state:** `text-red-600` with no `dark:text-red-400`, violating the established token set documented in `tasks/lessons.md` (every other red in the app has the dark variant).
- **Proposed improvement:** Add `dark:text-red-400`.
- **Category:** accessibility
- **Effort:** quick win

### 5.9 Action buttons stay live mid-save
- **Where:** `src/app/title/[id]/TitleDetail.tsx:169` (toggle, no `disabled`), `:173` (remove, no `disabled`)
- **Current state:** Refresh and Save honor `saving`, but the status toggle and Remove do not; a double-tap on Remove fires two DELETEs, and toggling during a save can interleave PATCHes.
- **Proposed improvement:** Disable all mutating actions while `saving` (or per-action pending flags if simultaneous independent actions are wanted).
- **Category:** state
- **Effort:** quick win

### 5.10 Save note is always enabled, even when unchanged
- **Where:** `src/app/title/[id]/TitleDetail.tsx:160`
- **Current state:** The button invites a save that does nothing. There's no dirty tracking.
- **Proposed improvement:** Disable until the note differs from the persisted value; re-disable after save. Small, but it makes the button honest.
- **Category:** micro-interaction
- **Effort:** quick win

### 5.11 Fifteen cast rows dominate the lower page
- **Where:** `src/app/title/[id]/TitleDetail.tsx:141-150`; cap set at `src/lib/tmdb.ts:46` (`slice(0, 15)`)
- **Current state:** Up to 15 single-line rows push the note field and all actions far below the fold on a phone. The user's own content (note, rating, status) loses the hierarchy battle to TMDB filler.
- **Proposed improvement:** Show the first 6 with a quiet "All 15" mono toggle, or set the list in two columns. Either restores the personal fields to reachable territory without losing data.
- **Category:** information hierarchy
- **Effort:** moderate

---

## 6. Components

### 6.1 ListToggle has no toggle semantics for assistive tech
- **Where:** `src/components/ListToggle.tsx:9-14`
- **Current state:** Two plain buttons; the active one is only distinguishable visually (background + shadow). No `aria-pressed`, no group label.
- **Proposed improvement:** Add `aria-pressed={value === ...}` to each button and an `aria-label` ("Filter by list") or `role="group"` wrapper.
- **Category:** accessibility
- **Effort:** quick win

### 6.2 The active segment jumps instead of sliding
- **Where:** `src/components/ListToggle.tsx:4-8`
- **Current state:** `transition-colors` only; the white active pill teleports between segments.
- **Proposed improvement:** A single sliding thumb (absolutely positioned, `transition-transform` ~180ms ease-out, `motion-reduce:transition-none`). This is the one place a moving element suits the identity: it is functional motion that shows the relationship between the two states, not decoration.
- **Category:** motion
- **Effort:** moderate

### 6.3 Toggle segments are ~36px tall
- **Where:** `src/components/ListToggle.tsx:4` (`p-2 text-sm`)
- **Current state:** Slightly below the 44px floor for the control used on every visit.
- **Proposed improvement:** `py-2.5` or `py-3` inside the existing pill.
- **Category:** touch
- **Effort:** quick win

### 6.4 TitleCard poster fallback is the strongest quiet moment in the app; extend it
- **Where:** `src/components/TitleCard.tsx:18-22`
- **Current state:** Missing posters render the title centered in the placeholder block, which is a genuinely nice editorial fallback. But it is `text-xs text-gray-500` sans, visually unrelated to the rest of the system.
- **Proposed improvement:** Set the fallback title in the mono signature (uppercase, tracked) so the no-poster card reads as a deliberate typographic "cover", almost a Penguin-classics move, rather than a degraded state. Zero new elements.
- **Category:** typography
- **Effort:** quick win

---

## 7. Cross-cutting

### 7.1 No motion system, only defaults
- **Where:** app-wide; current motion is skeleton pulse + assorted `transition-colors`/`transition-opacity`
- **Current state:** Motion is unconsidered rather than restrained. There is no shared duration/easing, and content (home grid, search results, detail page) pops in with no transition at all.
- **Proposed improvement:** Define one rule and apply it everywhere: 150-200ms ease-out, opacity and small translate only, `motion-reduce` honored everywhere (skeletons already do this; transitions should too). Content areas get a single quiet fade-in when data lands. One rule, no springs, no staggered theatrics.
- **Category:** motion
- **Effort:** moderate

### 7.2 Poster continuity between list and detail
- **Where:** navigation from `TitleCard` to `/title/[id]`
- **Current state:** Hard cut between screens; the poster you tapped and the poster on the detail page have no visual connection.
- **Proposed improvement:** A view transition morphing the tapped poster into the detail poster (View Transitions API; verify support in this Next.js version per `AGENTS.md` docs before committing). This is the flagship "quiet delight" candidate: no added elements, pure spatial continuity, and it degrades to the current cut on unsupported browsers and with reduced motion.
- **Category:** motion
- **Effort:** larger

### 7.3 No way to reload inside the installed app
- **Where:** app-wide; standalone display mode (`public/manifest.webmanifest:5`)
- **Current state:** In standalone mode there is no browser refresh button. The home list only refetches on remount, and a failed load (3.3) currently has no retry path at all.
- **Proposed improvement:** Retry buttons on error states cover the failure case (3.3); beyond that, refetch-on-focus (`visibilitychange`) keeps the list current when the PWA is re-opened from the background, which is the dominant real-world pattern. Full pull-to-refresh is likely over-engineering for this app.
- **Category:** state
- **Effort:** moderate

### 7.4 Add flow round-trip cost (workflow view)
- **Where:** home → search → detail → home loop
- **Current state:** The core loop "heard about a film, add it" costs: reach top-right (+ Add), type, tap small button, get ejected to detail, back, back. Two of those steps exist only because of 3.5, 4.1, and 4.2.
- **Proposed improvement:** No separate change; this item exists to record that 3.5 + 4.1 + 4.2 together transform the app's single most common workflow, and should be prioritized as a set rather than judged individually.
- **Category:** information hierarchy / workflow
- **Effort:** moderate (sum of parts)

---

## Top 5 quick wins

Highest impact for lowest effort across the whole list:

1. **Home screen honest states (3.1 + 3.2 + 3.3):** skeleton grid, per-tab empty states with a search link, and a real error state so a network blip never fakes an empty library. The most-visited screen currently has the weakest states in the app; all three are small, established patterns copied from search.
2. **Systematize the mono-metadata signature (1.1 + 5.2 + 6.4):** one shared style applied to home card metadata, detail metadata/labels/pills, and the no-poster fallback card. Pure class changes; the app's identity stops being a single-screen easter egg.
3. **Touch target sweep (4.1 + 4.5 + 5.1 + 6.3):** raise search add buttons, both back buttons, and the list toggle to 44px effective hit areas, and unify detail's back control with search's chevron pattern. Mechanical padding/margin changes with outsized effect on real-phone feel.
4. **Kill iOS focus zoom (1.2):** 16px input fonts on search and note fields. One-line change, removes the most jarring physical glitch in the mobile experience.
5. **Saved feedback plus save-state hygiene (5.3 + 5.8 + 5.9 + 5.10):** transient mono "SAVED" confirmation, dark-mode red fix, disable mutating buttons while saving, dirty-tracking on the note. Together they make the detail page's whole save system feel trustworthy.

Runner-up worth flagging despite being moderate: **the add-flow set (7.4: bottom-left add + stay-on-results after adding + URL-synced search)**, the single biggest workflow improvement available, and the bottom-left placement is specifically the left-handed win.
