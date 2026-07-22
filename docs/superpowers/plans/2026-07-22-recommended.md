# Recommended Feature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Each task is implemented and verified on its own; do NOT one-shot the feature.

**Goal:** Add a third screen, "Recommended", that suggests films/series based on the owner's watched titles and the ratings given to them. An LLM (Google Gemini, free tier) generates the suggestions server-side. Results are cached so the screen opens instantly; refresh is manual only. Each suggestion links into the existing preview/add flow.

**Architecture:** A `RecommendationProvider` interface (rating history in, structured suggestions out) with a Gemini implementation behind a `getProvider()` factory. A `recommend` service orchestrates history-build, provider call, TMDb resolution, library filtering, and caching. A `/api/recommendations` route exposes GET (latest cached set) and POST (regenerate). The `/recommended` screen renders the cached set and links each card to `/preview/{mediaType}/{tmdbId}`.

**Tech Stack:** Existing (Next.js App Router + TypeScript, Tailwind, Prisma, Neon Postgres, Vitest, Vercel) plus Google Gemini via server-side `fetch`. One new env var, `GEMINI_API_KEY`.

See the companion spec: `docs/superpowers/specs/2026-07-22-recommended-design.md`.

## Global Constraints

- **Project root:** `C:\Users\Wesley Vos\dev\watchlist-app`.
- **Provider abstraction is mandatory:** callers depend only on the `RecommendationProvider` interface via `getProvider()`. Swapping providers or adding Option C must not require touching callers. Verify this seam in Task 2.
- **Secrets via env only:** `GEMINI_API_KEY` read as `process.env.GEMINI_API_KEY`. Never hardcoded, never committed. Added as a normal (not "Sensitive") Vercel variable.
- **Migrations:** generate with `prisma migrate diff --from-schema-datamodel ... --to-schema-datamodel ... --script` (the project's safe method), never `prisma migrate dev`. Apply via `prisma migrate deploy`, which the Vercel build already runs.
- **Privacy whitelist:** only `{ title, year, mediaType, myRating }` of watched titles may be sent to Gemini. Assemble the prompt from that whitelist explicitly, never by serializing whole `Title` rows. No notes, no passcode, no credentials.
- **Manual generation only:** rows are written only by an explicit POST. Opening the screen (GET) never generates or writes.
- **Empty history is a valid 2xx state:** an owner with no rated titles gets `200 { empty: true }` from POST, never a 4xx. The screen treats any non-2xx as "keep the cached set," so empty history must stay 2xx.
- **Resolution reuses the shared TMDb matcher:** `resolveSuggestions` uses the same `evaluateMatch`/`pickDominantCandidate` discipline as `scripts/import-google-takeout.ts` (extracted into a shared module), with the LLM `year`/`mediaType` as strong pre-filters, and **drops ambiguous suggestions rather than guessing**. Do not write a weaker parallel matcher.
- **The screen never crashes on a bad LLM response:** every failure path (section 7 of the spec) degrades to a clear state, preferring a cached set over an error.
- **Verify each task** with `npx tsc --noEmit`, `npx eslint`, `npm test`, and (where a route/screen is involved) `npx next build`, before committing.
- **Commit** after every task. Do not push until the owner asks.

---

## Task 0: Prerequisites (manual, no code)

**Goal:** Obtain the Gemini key and wire the env var. Checklist; nothing to commit beyond the `.env.example` line.

- [ ] **Step 1: Get a Gemini API key**
  1. Go to Google AI Studio (https://aistudio.google.com), sign in.
  2. Create an API key (free tier). Copy it.

- [x] **Step 2: Confirm the current free-tier Flash model id**
  - **Confirmed 2026-07-22: `gemini-2.5-flash`** (free-tier eligible, same `generateContent` endpoint across tiers). This is the `GEMINI_MODEL` constant value used in Task 2.

- [ ] **Step 3: Wire the env var**
  - Add `GEMINI_API_KEY=` to `.env.example` (committed, empty).
  - Add the real key to `.env.local` (gitignored).
  - In Vercel, add `GEMINI_API_KEY` to all environments as a normal variable (not "Sensitive").

- [ ] **Step 4: Commit the example line**
  ```bash
  git add .env.example && git commit -m "chore: add GEMINI_API_KEY to env example for the recommended feature"
  ```

> Hand the key + confirmed model id to the implementer for Task 2.

---

## Task 1: Data & cache layer + migration

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_recommendation_set/migration.sql`, `src/lib/recommendations.ts`
- Test: `src/lib/__tests__/recommendations.test.ts`

**Interfaces:**
- Produces:
  - `RecommendationSet` model (spec section 6).
  - `getLatestRecommendationSet(): Promise<RecommendationSet | null>` (most recent by `generatedAt`).
  - `saveRecommendationSet(input: { suggestions: ResolvedSuggestion[]; model: string; sourceCount: number }): Promise<RecommendationSet>` (inserts a new row).

- [ ] **Step 1: Add the model to the schema**

Add to `prisma/schema.prisma`:
```prisma
model RecommendationSet {
  id          String   @id @default(cuid())
  suggestions Json     @default("[]")
  model       String
  sourceCount Int      @default(0)
  generatedAt DateTime @default(now())

  @@index([generatedAt])
}
```

- [ ] **Step 2: Generate the migration with the diff method (not migrate dev)**

Generate SQL by diffing the committed migrations against the edited schema, into a new migration folder, then apply with `migrate deploy`:
```bash
npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema-datamodel prisma/schema.prisma \
  --script > prisma/migrations/<timestamp>_add_recommendation_set/migration.sql
npx prisma migrate deploy
npx prisma generate
```
Expected: a single `CREATE TABLE "RecommendationSet"` (+ index), applied cleanly. Confirm no other pending migration is swept in.

- [ ] **Step 3: Implement the repository**

Create `src/lib/recommendations.ts` with `getLatestRecommendationSet()` (findFirst, `orderBy: { generatedAt: "desc" }`) and `saveRecommendationSet()` (create, casting `suggestions` to `Prisma.InputJsonValue`). Import `ResolvedSuggestion` from the recommend types (Task 2 defines it; this task may define a temporary local type and switch to the shared one in Task 2, or Task 2 can be sequenced first for the type. Prefer defining `ResolvedSuggestion` in `src/lib/recommend/types.ts` up front and importing it here.)

- [ ] **Step 4: Test the repository semantics**

Create `src/lib/__tests__/recommendations.test.ts` (mock `@/lib/prisma`): assert `getLatestRecommendationSet` returns `null` when the table is empty and the most-recent row otherwise; assert `saveRecommendationSet` calls `create` with the given `suggestions`/`model`/`sourceCount`.

**Verification:** migration applies (`CREATE TABLE` only, nothing else); `npm test -- recommendations` passes; `npx tsc --noEmit` clean.

- [ ] **Step 5: Commit**
```bash
git add -A && git commit -m "feat: add RecommendationSet model, migration, and repository"
```

---

## Task 2: Provider-abstracted recommend service (the LLM seam)

**Files:**
- Create: `src/lib/recommend/types.ts`, `src/lib/recommend/provider.ts`, `src/lib/recommend/gemini.ts`
- Test: `src/lib/recommend/__tests__/gemini.test.ts`, `src/lib/recommend/__tests__/provider.test.ts`

**Interfaces:**
- Produces (spec sections 5, 10):
  - Types: `RatedTitle`, `RawSuggestion`, `ResolvedSuggestion`, `RecommendationRequest`, `RecommendationProvider`.
  - `getProvider(): RecommendationProvider` factory (the swap point).
  - `GeminiRecommendationProvider` implementing `recommend(req): Promise<RawSuggestion[]>` and exposing `model`.
  - `parseSuggestions(raw: unknown): RawSuggestion[]` (drop-invalid, never throw on partial).
  - `GEMINI_MODEL` constant (from Task 0 Step 2).

- [ ] **Step 1: Define the types**

Create `src/lib/recommend/types.ts` with the interfaces from spec sections 5 and 10, including the commented-out `candidatePool?` field on `RecommendationRequest` (Option C seam) so its intended place is visible.

- [ ] **Step 2: Define the provider interface + factory**

Create `src/lib/recommend/provider.ts`:
```ts
import type { RecommendationProvider } from "./types";
import { GeminiRecommendationProvider } from "./gemini";

// Single swap point. Swapping LLMs later = return a different implementation here.
export function getProvider(): RecommendationProvider {
  return new GeminiRecommendationProvider();
}
```

- [ ] **Step 3: Write failing tests for parsing + the Gemini call (mocked fetch)**

Create `src/lib/recommend/__tests__/gemini.test.ts`. Cover, with a mocked `fetch` returning a realistic Gemini `generateContent` envelope:
- Valid JSON array of suggestions maps to `RawSuggestion[]`.
- A response mixing valid + malformed entries keeps only the valid ones.
- Invalid outer JSON (unparseable `text`) throws a typed error.
- Zero valid entries throws (caller treats as failure).
- A non-200 response throws.
- The request body sets `responseMimeType: "application/json"` and includes the rating history but **no** disallowed fields (assert the serialized prompt contains a rated title but not a note/passcode).
- The call aborts after the timeout (fake timers + an AbortController assertion).

Create `src/lib/recommend/__tests__/provider.test.ts`: assert `getProvider()` returns something implementing `recommend` and exposing a non-empty `model`.

- [ ] **Step 4: Run to verify fail**

Run `npm test -- recommend`. Expected: FAIL (modules not implemented).

- [ ] **Step 5: Implement `parseSuggestions` and the Gemini provider**

Create `src/lib/recommend/gemini.ts`:
- `GEMINI_MODEL` constant.
- Prompt builder that takes `RatedTitle[]` and emits an instruction to return the JSON array, embedding only whitelisted fields.
- `recommend()`: `fetch` POST to `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${process.env.GEMINI_API_KEY}` with `generationConfig: { responseMimeType, responseSchema, temperature }`, wrapped in an `AbortController` timeout (~20s). On non-200 or abort, throw a typed `RecommendationError`. On 200, extract `candidates[0].content.parts[0].text` and hand to `parseSuggestions`; if it yields zero entries, throw.
- `parseSuggestions`: `JSON.parse` in try/catch, filter to valid entries (spec section 5), trim + length-cap `reason`, coerce `year`.

> **Implementation note:** confirm the endpoint path, `responseSchema` shape, and model id against current Google AI Studio docs before finalizing (per AGENTS.md, the API may differ from training data). These live in this one file.

- [ ] **Step 6: Run to verify pass**

Run `npm test -- recommend`. Expected: PASS. `npx tsc --noEmit` + `npx eslint src/lib/recommend` clean.

**Verification:** the provider is fully exercised with a mocked network, proving parse/validation/timeout/privacy behaviour without any real Gemini call; the factory seam is covered.

- [ ] **Step 7: Commit**
```bash
git add -A && git commit -m "feat: add provider-abstracted Gemini recommend service with JSON validation"
```

---

## Task 3: Orchestration (resolution + filtering + caching) + API route

**Files:**
- Create: `src/lib/recommend/service.ts`, `src/app/api/recommendations/route.ts`
- Test: `src/lib/recommend/__tests__/service.test.ts`, `src/app/api/__tests__/recommendations.route.test.ts`

**Interfaces:**
- Consumes: `getProvider` (Task 2), `getLatestRecommendationSet`/`saveRecommendationSet` (Task 1), `searchTitles` (existing TMDb client), titles repo/`prisma` (library filtering).
- Produces:
  - `buildRatedHistory(): Promise<RatedTitle[]>` (WATCHED titles with a non-null `myRating`, mapped to the whitelist).
  - `resolveSuggestions(raw: RawSuggestion[]): Promise<ResolvedSuggestion[]>` (TMDb search per title → attach `tmdbId`/poster/canonical year; drop unresolved; drop titles already in the library; dedupe). **Uses the shared disambiguation discipline** from `scripts/import-google-takeout.ts` (`evaluateMatch` + `pickDominantCandidate`), with the LLM `year` + `mediaType` as strong pre-filters, and **drops any genuinely ambiguous suggestion** rather than guessing (spec section 4).
  - `generateRecommendations(): Promise<RecommendationSet>` (history → provider → resolve → persist).
  - `GET /api/recommendations` → latest set or `null`. `POST /api/recommendations` → regenerate, with all failure handling.

- [ ] **Step 1: Write failing tests for the service (mock provider, TMDb, repos)**

Create `src/lib/recommend/__tests__/service.test.ts`:
- `buildRatedHistory` returns only WATCHED + rated titles, mapped to `{title, year, mediaType, myRating}` only.
- `resolveSuggestions`: a raw title that TMDb finds gets a `tmdbId`; one TMDb cannot find is dropped; one already in the library is dropped; duplicates collapse.
- `resolveSuggestions` disambiguation: the LLM `year` + `mediaType` filter the TMDb results first; a single clearly dominant candidate (per the shared `pickDominantCandidate` vote-count/popularity rule) is taken; **a genuinely ambiguous case (no dominant winner) is dropped, not guessed.** Assert both the accept-on-dominance and drop-on-ambiguity outcomes.
- `generateRecommendations` with an empty history does **not** call the provider (returns/raises the empty-history condition).
- If resolution drops everything, generation is treated as failure (throws), so the route can 502.

- [ ] **Step 2: Write failing tests for the route (mock the service)**

Create `src/app/api/__tests__/recommendations.route.test.ts`:
- `GET` returns the cached set (200) and `null` (200) when none exists; never generates.
- `POST` returns the new set (200) on success.
- `POST` returns `502` when the provider fails and `504` on timeout.
- `POST` with empty rating history returns **`200` with `{ empty: true }`** (NOT a 4xx) so the screen shows the "rate first" state without tripping its non-2xx error path. Assert both the `200` status and the `{ empty: true }` body.
- `POST` never throws to the client (always structured JSON).

- [ ] **Step 3: Run to verify fail**

Run `npm test -- recommend service` and `npm test -- recommendations.route`. Expected: FAIL.

- [ ] **Step 4: Implement the service**

Create `src/lib/recommend/service.ts`: `buildRatedHistory` (query WATCHED + `myRating != null`, map to whitelist); `resolveSuggestions` (for each raw suggestion, `searchTitles(title)`, then **reuse the shared disambiguation discipline** from `scripts/import-google-takeout.ts` rather than a new matcher: pre-filter results by the LLM `mediaType` + `year`, then run the `evaluateMatch`/`pickDominantCandidate` logic, take a clearly dominant match, **drop on ambiguity**; attach `tmdbId`/poster/year, filter against library by `tmdbId`+`mediaType`, dedupe); `generateRecommendations` (build history; if empty, signal empty; else `getProvider().recommend()` → `resolveSuggestions` → if empty after resolution, throw; else `saveRecommendationSet` with `provider.model` and `sourceCount`).

> **Extract the matcher, don't duplicate it.** The `evaluateMatch` / `pickDominantCandidate` / `DOMINANCE_RATIO` / floor logic currently lives inside `scripts/import-google-takeout.ts`. Lift it into a shared module (e.g. `src/lib/tmdbMatch.ts`) that both the import script and `resolveSuggestions` import, so the two resolution paths cannot drift. This extraction is code movement only (behaviour-preserving) and is covered by the existing import script's behaviour plus the new `resolveSuggestions` tests.

- [ ] **Step 5: Implement the route**

Create `src/app/api/recommendations/route.ts`: `GET` returns `getLatestRecommendationSet()`. `POST` calls `generateRecommendations()` in try/catch, returning **`200` with `{ empty: true }` for empty history** (a valid state, never a 4xx), `504` on timeout, and any other failure as `502`, always returning structured JSON and never throwing to the client.

- [ ] **Step 6: Run to verify pass + build**

Run `npm test -- recommend` and `npm test -- recommendations.route`. Expected: PASS. Run `npx next build`. Expected: the `/api/recommendations` route appears and the build is clean.

**Verification:** unit tests prove resolution drops hallucinated/duplicate/in-library titles and that every failure maps to the right status without throwing; build confirms the route compiles.

- [ ] **Step 7: Commit**
```bash
git add -A && git commit -m "feat: add recommend orchestration (resolve, filter, cache) and API route"
```

---

## Task 4: Recommended screen + nav + add-flow linking

**Files:**
- Create: `src/app/recommended/page.tsx`, `src/components/SuggestionCard.tsx`
- Modify: `src/app/page.tsx` (add the "Recommended" nav entry)
- Test: `src/app/recommended/__tests__/recommended.test.tsx`

**Interfaces:**
- Consumes: `GET`/`POST /api/recommendations`.
- Produces: the `/recommended` screen (Back link, "Generated on [date]" caption, Refresh button, suggestion grid) with cards linking to `/preview/${mediaType.toLowerCase()}/${tmdbId}`; a Home nav button routing to `/recommended`.

- [ ] **Step 1: Build the SuggestionCard**

Create `src/components/SuggestionCard.tsx`: poster tile (reuse the Home card aspect/styling), title, year + media type in the `meta` style, and the one-line reason. The whole card is a `Link` to `/preview/${mediaType.toLowerCase()}/${tmdbId}`.

- [ ] **Step 2: Build the screen with its states**

Create `src/app/recommended/page.tsx` (client): on mount `GET`s the cached set and renders instantly. States: loading, first-run (history exists, no set → "Generate" button), empty-history ("rate some watched titles"), populated (grid + caption + Refresh), soft-error (populated + non-blocking message). Refresh POSTs; on non-2xx it keeps the current set and shows the soft message (spec section 7). Use the `BackLink` pattern from Search for the header.

- [ ] **Step 3: Add the Home nav entry**

Modify `src/app/page.tsx`: add a "Recommended" button/link in the header area, consistent with the existing "+ Add"/search vocabulary, routing to `/recommended`. Do not disturb the existing tab/filter/sort behaviour.

- [ ] **Step 4: Test the screen (mock fetch)**

Create `src/app/recommended/__tests__/recommended.test.tsx`: a cached set renders cards with correct `/preview/...` hrefs and the "Generated on" caption; a refresh failure (non-2xx) keeps the existing cards and shows the soft message; a `200 { empty: true }` refresh response shows the "rate first" state and does not render cards (and is NOT treated as an error).

- [ ] **Step 5: Verify**

Run `npm test -- recommended`. Expected: PASS. `npx tsc --noEmit`, `npx eslint`, `npx next build` clean. Run the app locally, confirm Home → Recommended navigation and that a card opens the existing preview/add page.

- [ ] **Step 6: Commit**
```bash
git add -A && git commit -m "feat: add Recommended screen, Home nav entry, and add-flow linking"
```

---

## Task 5: Polish, states, and phone check

**Files:**
- Modify: `src/app/recommended/page.tsx`, `src/components/SuggestionCard.tsx` (and Home nav) as needed for polish only.

**Interfaces:** none new; refinement of Task 4.

- [ ] **Step 1: State visuals**

Refine the loading/generating indicator (generation can take a few seconds), the "Generated on [date]" caption formatting (human-readable date), the first-run and empty-history copy, and the soft-error message. Ensure the Refresh button shows an in-progress state and is disabled while generating.

- [ ] **Step 2: Accessibility & affordances**

Real tap targets on the Refresh and nav buttons; `aria-label`s where the control is icon-only; cards keyboard-focusable (they are `Link`s already). Respect `prefers-reduced-motion` for any spinner.

- [ ] **Step 3: Verify + phone check**

Run the full suite (`npm test`), `npx tsc --noEmit`, `npx eslint`, `npx next build`, all clean. Then, with a real `GEMINI_API_KEY` in `.env.local`: generate a set, confirm suggestions resolve and link into the add flow, add one to Want, refresh, and confirm the "Generated on" caption updates. Finally judge the feel on the phone (this is UI, so on-device is the real test).

- [ ] **Step 4: Commit**
```bash
git add -A && git commit -m "polish: recommended screen states, accessibility, and copy"
```

---

## Self-Review

**Spec coverage:**
- Third screen reached by a "Recommended" nav button → Task 4. ✓
- LLM suggestions from watched titles + ratings, server-side → Tasks 2, 3. ✓
- Manual refresh only + "Generated on [date]" caption → Tasks 3, 4, 5. ✓
- Cached, opens instantly (GET never generates) → Tasks 1, 3, 4. ✓
- Google Gemini free tier, `process.env.GEMINI_API_KEY`, no Claude → Tasks 0, 2. ✓
- Thin provider interface + factory (swap-ready) → Task 2. ✓
- Option C designed for, not built (request field + service step + prompt branch) → spec section 11; interface field present in Task 2 types. ✓
- Exact LLM return shape + parse/validate → Task 2 (`RawSuggestion`, `parseSuggestions`). ✓
- Failure handling (fail/timeout/malformed/unresolved), screen never crashes → Tasks 2, 3, 4. ✓
- Empty history is `200 { empty: true }`, not a 4xx (keeps the screen's non-2xx error path clean) → Tasks 3, 4, Global Constraints. ✓
- Resolution reuses the import script's `evaluateMatch`/`pickDominantCandidate` discipline (extracted to shared module), LLM year/mediaType as strong pre-filters, drops on ambiguity → Tasks 3, spec section 4, Global Constraints. ✓
- Suggestion links into existing preview/add flow; external titles not yet in DB → Tasks 3 (resolution), 4 (linking). ✓
- Caching table + timestamp, manual only → Tasks 1, 3. ✓
- Privacy whitelist (titles + ratings only) → Task 2 (asserted in tests), Global Constraints. ✓
- "Not interested"/dismiss deferred, with no v1 schema cost to leave room (mirrors the existing library filter) → spec section 14. ✓

**Task independence:** each task compiles, tests, and commits on its own; Task 1 and Task 2 can be built in either order provided `ResolvedSuggestion` lives in `src/lib/recommend/types.ts` from the start (noted in Task 1 Step 3). ✓

**No code shipped this round:** this document and the spec only; no schema change, migration, or code is applied until the plan is approved. ✓
