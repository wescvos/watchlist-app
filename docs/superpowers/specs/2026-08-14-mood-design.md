# Mood Feature: Design Spec

**Date:** 2026-08-14
**Status:** Draft (pending implementation-plan review)
**Project location:** `C:\Users\Wesley Vos\dev\watchlist-app`
**Replaces:** the "For You" recommendations feature (spec `2026-07-22-recommended-design.md`)

## 1. Purpose

A "Mood" screen, reached from a nav entry where "For You" currently sits, that
answers one question: *"I want something \_\_\_\_, what's on my list?"* It shows a
grid of eleven moods; tapping one shows every title on the **Want to watch** list
carrying that mood, as an ordinary poster grid.

Moods are **pre-tagged onto titles and stored.** Browsing is a plain database
filter: instant, free, and with no rate-limit exposure at browse time. The LLM
runs once per title at tagging time, never per mood tap.

This replaces "For You", where an LLM invented suggestions from rating history
and each one had to be resolved against TMDb. That feature does not work well
enough to keep. The new feature points the same LLM at a much easier job
(classifying a title you already own) and puts its output behind a database
index instead of in front of the user in real time.

## 2. Core use cases

- Open Mood, see eleven moods with a count of matching Want titles on each.
- Tap "Tense & gripping", see all matching Want titles as a poster grid, instantly.
- Tap a poster, land on the existing title detail page.
- Add a title normally, and have it tagged without doing anything extra.
- Run a one-off backfill so the existing Want list becomes browsable.

Explicitly **not** in scope: mood browsing over the Watched list (titles are
tagged regardless of status, so this is a later filter change and no re-tagging),
manual mood editing, mood-based sorting on Home, and any per-mood LLM call.

## 3. What is being removed (code only, tables stay)

The "For You" feature is deleted. Verified inventory:

**Delete outright**

| Path | Lines |
|---|---|
| `src/app/recommended/page.tsx` | 184 |
| `src/app/recommended/__tests__/recommended.test.tsx` | 114 |
| `src/app/api/recommendations/route.ts` | 38 |
| `src/app/api/recommendations/dismiss/route.ts` | 20 |
| `src/app/api/__tests__/recommendations.route.test.ts` | 74 |
| `src/app/api/__tests__/dismiss.route.test.ts` | 32 |
| `src/components/SuggestionCard.tsx` | 49 |
| `src/lib/recommend/service.ts` | 156 |
| `src/lib/recommend/provider.ts` | 8 |
| `src/lib/recommend/types.ts` | 54 |
| `src/lib/recommend/__tests__/service.test.ts` | 196 |
| `src/lib/recommend/__tests__/provider.test.ts` | 12 |
| `src/lib/recommendations.ts` | 46 |
| `src/lib/__tests__/recommendations.test.ts` | 53 |

**Modify**

- `src/app/page.tsx` lines 285 to 293: the "For You" `Link` is **removed entirely, with no replacement.** The "Mood" nav entry is added later, in the same slot, alongside the screens it points to (section 11).
- `src/lib/recommend/gemini.ts` (234 lines): **do not delete.** Its reusable half is extracted first (section 12), then the recommend-specific half goes with it.

**Keep, despite matching a grep for "recommend"**

- `src/lib/tmdbMatch.ts` and `src/lib/__tests__/tmdbMatch.test.ts`. The shared TMDb matcher is also used by `scripts/import-google-takeout.ts` and has its own tests. Only its comment referencing the Recommended feature needs updating.
- `src/app/title/[id]/TitleDetail.tsx` line 282. The match is the note placeholder copy ("Who recommended it, talking points, thoughts…"), unrelated.

**Database: no destructive migration.** The `RecommendationSet` and
`DismissedTitle` tables **stay in place** in `prisma/schema.prisma` and in Neon,
even though no code reads them after this change. Dropping them is a separate
later cleanup, deliberately not bundled with a feature change. This does mean
the Prisma schema temporarily describes two unused tables; that is the intended
trade, and the models should carry a comment saying so.

## 4. Architecture & data flow

Two flows that never meet at request time. That separation is the whole design.

```
TAGGING (write path, LLM, rare)
  add a title      → upsert Title → after() → tagIfUntagged(id)  → Gemini (1 title)
  refresh a title  → update Title → after() → tagIfUntagged(id)  → Gemini (1 title)
  backfill script  → untagged WANT titles → batches of 20        → Gemini (17 calls)
                                                                  ↓
                                              Title.moods = ["Tense & gripping", ...]
                                              Title.moodsTaggedAt = now()

BROWSING (read path, no LLM, every time)
  /mood            → one query over WANT titles → count per mood → picker grid
  /mood/[slug]     → WHERE status='WANT' AND moods @> ARRAY['Tense & gripping']
                   → poster grid of TitleCard
```

The browse path is server-rendered from Postgres. It makes no LLM call, no
network call, and no client-side fetch, so it cannot rate-limit, cannot fail
mid-render, and cannot flash (section 11).

## 5. The eleven moods

Framed as "I want something…", describing **what you want to watch**, not how
you currently feel. The set is closed at eleven, in this canonical order:

| # | Mood | Working definition for the tagger |
|---|---|---|
| 1 | **Light & funny** | Comedic and low-stakes. The laughs are the point; you can watch it tired. |
| 2 | **Feel-good** | Warm and uplifting; it leaves you better than it found you. May be dramatic, but the arc resolves kindly. |
| 3 | **Tense & gripping** | Sustained suspense or pressure that makes it hard to look away. Thrillers, heists, slow-burn dread. |
| 4 | **Dark & heavy** | Bleak, grim, or emotionally punishing. You have to be in the mood for it. |
| 5 | **Thoughtful** | Slow, meditative, cerebral **in tone and pace**. Rewards patience and attention. |
| 6 | **Beautiful & calm** | Visually gorgeous and unhurried. The images and atmosphere are the draw. |
| 7 | **Weird** | Surreal, offbeat, formally strange **in execution**. Dream logic, absurdism, tonal oddity. |
| 8 | **Big & thrilling** | Spectacle, scale, momentum, action. Blockbuster energy. |
| 9 | **Romantic** | A central love story drives the film. |
| 10 | **Scary** | Made to frighten. Horror, dread, terror. |
| 11 | **Conceptual** | See section 5.1. Tightly bounded, because it is the one that over-tags. |

Definitions 1 to 10 are deliberately one line each. Conceptual gets a full
block because it is the only mood whose failure mode is enthusiastic
over-application.

### 5.1 Conceptual (tight definition)

Films built around a distinctive central **premise or idea that the whole film
is structured to explore.** High-concept, puzzle-box, "what if X" hooks. The
concept drives the film's **architecture**, not merely its plot.

**Operative test:** if the film could be described without its premise and still
make sense, it is **not** Conceptual.

**Positive examples:** Primer, Coherence, Predestination, Triangle, Memento,
Palm Springs, Arrival, Perfect Blue, Adaptation, The Double, Groundhog Day,
Eternal Sunshine, The Prestige, Being John Malkovich, Source Code, The Truman
Show.

**Do NOT tag Conceptual for:**

- A well-crafted character drama.
- A twisty thriller whose twist is a plot reveal rather than the premise itself.
- A film that is merely intelligent, or merely slow.

Being clever or serious does not qualify a film. The premise has to be
load-bearing: remove it and the film has no shape left.

### 5.2 Conceptual is not Thoughtful and is not Weird

These three sit next to each other and the tagger must not treat them as
synonyms. They are separate axes, each judged on its own criteria.

| Mood | What it measures | Why that is not Conceptual |
|---|---|---|
| **Thoughtful** | Tone and pace: slow, meditative, cerebral. | Conceptual films can be brisk and fun. **Palm Springs** is Conceptual without being Thoughtful. |
| **Weird** | Surreal, offbeat, strange **execution**. | **Arrival** is Conceptual but not Weird: conventional execution, extraordinary premise. |

### 5.3 Multi-tagging is correct

Titles carry **multiple** moods. Parasite is Tense & gripping + Dark & heavy +
Thoughtful. That is the expected shape, not a tagging error.

Worked examples for the prompt:

- **Primer** = Conceptual + Thoughtful
- **Perfect Blue** = Conceptual + Weird + Tense & gripping
- **Palm Springs** = Conceptual + Light & funny (not Thoughtful)
- **Arrival** = Conceptual + Thoughtful (not Weird)
- **Parasite** = Tense & gripping + Dark & heavy + Thoughtful

Typical output is 1 to 4 moods per title. The instruction is "assign every mood
that genuinely applies, and no mood that merely partly fits." No hard per-title
cap is enforced in validation, because a legitimate five-mood title should not
be silently truncated; the count is a prompt instruction, not a constraint.

**A title matching no mood at all is allowed** (section 10).

## 6. What the LLM returns

Structured JSON, not prose, using the same `responseMimeType` +
`responseSchema` mechanism the recommend provider already proved out.

### What is sent, per title

Exactly five fields, assembled explicitly from a whitelist (never a whole
`Title` row):

```ts
interface TaggableTitle {
  index: number;              // position in this batch, for mapping the reply back
  title: string;
  year: number | null;
  mediaType: "MOVIE" | "TV";
  genres: string[];           // already on the row, from TMDb
  overview: string | null;    // truncated to OVERVIEW_MAX_CHARS (400)
}
```

The overview is truncated to **400 characters** at a word boundary. TMDb
overviews run roughly 300 to 700 characters; 400 keeps the premise and tone
signal (which is what a mood judgement needs) while bounding the per-title input
cost that drives section 7's arithmetic.

### What comes back

```ts
interface RawMoodTagging {
  index: number;      // echoed back, maps to the request batch
  title: string;      // echoed back, used only as a cross-check
  moods: string[];    // zero or more of the eleven exact labels
}
```

`responseSchema` (conceptual):

```
{
  type: "array",
  items: {
    type: "object",
    properties: {
      index: { type: "integer" },
      title: { type: "string" },
      moods: { type: "array", items: { type: "string", enum: [ ...the 11 labels ] } }
    },
    required: ["index", "moods"]
  }
}
```

The `enum` does most of the validation work, but as with the recommend provider
it is treated as a strong hint rather than a guarantee.

### Parsing and validation

Hand-rolled, matching the codebase's existing hand-rolled validation, reusing
the guarded parsing discipline from `gemini.ts` (section 12). Per entry:

- `index` must be an integer within the batch range. Out of range, drop the entry.
- `title` if present must be a close match for the batch entry at that index. A mismatch means the model lost alignment, so drop the entry rather than write moods onto the wrong film.
- `moods` must be an array. Each element is matched **exactly** against the eleven canonical labels; unknown strings are dropped individually, and duplicates collapse. An entry whose moods all get dropped becomes a legitimate empty result, not a failure.
- Entries missing from the response are simply left untagged; the next backfill run picks them up, because the backfill selects on `moodsTaggedAt IS NULL`.

**Drop-invalid-but-keep-valid**, exactly as the recommend parser did: one
malformed entry never discards the batch. Only genuinely unparseable or
non-array JSON is a failure.

**A batch response is written per title, not all-or-nothing.** Each valid entry
writes its own row, so a batch that returns 18 usable entries out of 20 tags 18
titles and leaves 2 for the next run.

## 7. Batch size and token budget (the arithmetic)

This is the constraint that killed the recommend feature's output once already,
so it is decided here with the numbers shown rather than left to the
implementer.

### The binding constraint

`gemini-flash-latest` is a **thinking model whose reasoning tokens share
`maxOutputTokens`.** Per the comment in `src/lib/recommend/gemini.ts`,
`thoughtsTokenCount` was observed at 1,000 to 1,600, and a 2,048 ceiling left so
little headroom that the JSON truncated mid-array and the parse dropped
everything. `thinkingBudget: 0` is rejected with a 400 on this model, so the
ceiling is the only lever.

`maxOutputTokens` stays at **8,192**. Input is *not* the constraint (Flash's
input window is orders of magnitude larger than anything here). **Thinking plus
JSON output against 8,192 is the constraint.**

### Per-title estimates

| Term | Estimate | Basis |
|---|---|---|
| Input, per title | ~150 tokens | title ~8, year ~3, mediaType ~2, genres ~12, overview 400 chars ~100, JSON punctuation ~10, rounded up |
| Input, fixed preamble | ~1,200 tokens | instructions ~200, ten short mood definitions ~500, the Conceptual block (915 characters, ~230), schema and formatting overhead |
| Output, per title | ~40 tokens | echoed title ~8, 2.5 moods average at ~5 each ~13, punctuation ~10, rounded up |
| Thinking, per title | ~200 tokens | deliberately pessimistic: eleven criteria weighed per title. The observed 1,000 to 1,600 for one 12-item generative call is well under this per unit of work |

### Candidate batch sizes

Output budget used = `N × (40 + 200)`, against 8,192.

| N | Thinking + output | % of 8,192 | Headroom | Requests for 327 titles | Verdict |
|---|---|---|---|---|---|
| 16 | 3,840 | 47% | 53% | 21 | Rejected: over the daily cap outright |
| **20** | **4,800** | **59%** | **41%** | **17** | **Chosen** |
| 25 | 6,000 | 73% | 27% | 14 | Workable, thinner output margin |
| 30 | 7,200 | 88% | 12% | 11 | Rejected: this is the starvation shape that emptied recommend responses |

**Decision: `TAG_BATCH_SIZE = 20`.**

At N = 20 the input is `1,200 + 20 × 150 = 4,200` tokens, comfortably small, and
20 items also respects the AGENTS.md guidance to keep the input history bounded
around 40 items.

**Measured against the real prompt (Task 3):** the preamble is 3,195 characters
(~799 tokens, against the ~1,200 estimated) and a real title costs ~82 tokens
rather than ~150, because most TMDb overviews land under the 400-character
truncation. A full batch of 20 is ~2,445 input tokens, about 58% of the
estimate. This does **not** license a larger batch: the binding constraint is
thinking plus output against the 8,192 ceiling, which these figures say nothing
about. It simply means the input side has even more margin than assumed.

### Does a full backfill fit in one day?

The free tier allows **20 requests per day** (confirm against current Google AI
Studio limits at implementation time; if the number has changed, only this
subsection's conclusion changes, not the batch size). It **also caps requests
per minute at 5**, which is a separate constraint and is handled in section 7.1.

```
Want titles to tag          327   (measured, Task 2)
Batch size                   20
Requests needed    ceil(327 / 20) = 17
Free-tier daily cap          20
Spare                         3
```

**Yes.** A full backfill of the 327 Want titles takes **17 requests and fits in
a single day**, leaving **3 requests spare** for retrying failed batches.

Note what does *not* fit: the library is **531 titles** in total (327 Want, 204
Watched), and tagging all of them would be `ceil(531 / 20)` = **27 requests**,
comfortably over the daily cap. Want-first ordering is therefore not a nicety,
it is what keeps the browsable set inside one day's quota. The Watched
remainder tags itself over subsequent days, or on demand, and nothing depends
on it until mood browsing extends to Watched (section 15).

Sensitivity worth knowing: at N = 20 the one-day backfill holds up to **400
titles** (20 requests of 20 titles), so 327 leaves 73 titles of headroom before
the Want list alone needs a second day. Past that it spans two days, which costs
nothing extra because the script is resumable by construction (it selects
`moodsTaggedAt IS NULL`, so re-running continues rather than restarts).

### 7.1 The per-minute cap, and why pacing is mandatory

The daily cap is not the only limit. The free tier also allows **5 requests per
minute**, and that one bites first.

An earlier draft of this section concluded that no inter-request delay was
needed "because it is 17 requests, not 327." That reasoning only considered the
daily cap and was **wrong**. Fired back to back, a 17-batch backfill would 429
on its **6th request, inside the first minute**. The failure looks especially
misleading: the run stops as designed, the daily budget still shows 15 requests
remaining, and yet only 100 of 327 titles got tagged. Five of the day's twenty
requests would have been spent to do less than a third of the work.

So pacing is a **correctness requirement, not politeness**:

- `INTER_REQUEST_DELAY_MS = 15_000` in `src/lib/mood/tagger.ts`, applied before every request except the first. 15s holds the rate at 4/minute, one under the cap.
- It lives in the tagger, not the script, because that is where the batch loop is. It **defaults on**, so any future multi-batch caller is paced whether or not it remembers to ask; only tests pass `delayMs: 0`.
- A full Want backfill therefore takes **~4 minutes** (16 gaps of 15s plus response time), which costs nothing for a one-off script.
- A test asserts the constant stays at or above 13s, so a later "optimisation" that shortens it fails the suite rather than silently reintroducing the 429.
- The single-title add/refresh path makes one request and so never waits.

Because both caps return the same 429, the backfill's stop message names both
possibilities: with pacing in place, a 429 early in a run means the delay is too
short, while a 429 near the end means the day is genuinely spent. The client
already logs the non-200 body, which names the quota that was hit.

### Incremental tagging cost

Tagging at add or refresh is a single-title call (N = 1): roughly 1,350 input
tokens and a few hundred output-plus-thinking tokens, far inside every limit.
The real limit is the **shared daily request budget**: adds and backfill draw
from the same 20 per day. Adding more than about twenty titles in one day, or
adding titles on the same day as a backfill, means some titles go untagged until
the next run. That degrades gracefully (section 10) and the backfill sweeps them
up.

### The one-time hazard: browsing before the first backfill

There is a narrow window where incremental tagging can eat the whole daily quota
before the backfill gets any, and it exists exactly once.

The `moodsTaggedAt IS NULL` gate is what normally keeps tagging bounded, because
an already-tagged title never calls Gemini again. But **before the first backfill
runs, every title in the library is untagged**, so the gate is open on all 531
of them. The staleness auto-refresh in `src/app/title/[id]/page.tsx` re-fetches
any title older than 30 days on view, and once tagging is wired into that path it
also fires one tagging request per stale title viewed. Opening roughly twenty
stale titles would therefore consume the entire 20-request daily allowance, one
title at a time, and the backfill would then fail on rate limits with nothing
left for its 17 batches.

The mitigation is operational, not architectural, because the exposure is
one-time and the alternative (suppressing incremental tagging until some
"backfilled" flag is set) is more machinery than the problem deserves:

1. Deploy the tagging triggers and run the backfill **on a fresh daily quota.**
2. **Do not browse the app between deploying the triggers and running the backfill.**
3. The backfill prints its running request count, so remaining quota is visible at a glance rather than inferred.

After the backfill, the gate is closed for every existing title and incremental
tagging costs one request per newly added title, which is the steady state the
budget was sized for.

## 8. Data model

One new column plus one timestamp on `Title`. No new tables.

```prisma
model Title {
  // ... existing fields
  genres           String[]
  spokenLanguages  String[]
  moods            String[]      // canonical mood labels, mirrors genres
  moodsTaggedAt    DateTime?     // null = never tagged; set = tagged, even if moods is empty
}
```

- **`moods`** is a native Postgres `TEXT[]` exposed as Prisma `String[]`, mirroring `genres` and `spokenLanguages` exactly, as required. It stores the **canonical labels** ("Tense & gripping"), not slugs, because that is how `genres` stores its values and because validation guarantees only the eleven exact labels are ever written.
- **`moodsTaggedAt`** exists because `moods = []` is otherwise ambiguous: it cannot distinguish "we asked the model and it legitimately matched no mood" (section 10) from "never tagged." Every consumer needs that distinction: the backfill uses it to select work, the incremental tagger uses it for idempotency, and the screen uses it for the untagged count. It is the one field carrying its weight beyond mirroring `genres`.

**Deliberately not added:** a `moodsModel` provenance column. `RecommendationSet`
carried a `model` field, but that row was a generated artifact with a lifecycle;
a mood tag is cached metadata like `genres`, which has no provenance column
either. If a prompt revision ever requires a full re-tag, the operation is
"clear `moodsTaggedAt` and re-run the backfill," which needs no extra column.

**No index on `moods`.** A `has` filter over ~530 rows is a trivial sequential
scan, and neither `genres` nor `spokenLanguages` is indexed. A GIN index is a
one-line addition if the library ever grows by an order of magnitude.

### Migration

Generated with the project's read-only diff method, **never `migrate dev`** (not
even `--create-only`), and applied by `prisma migrate deploy`, which
`npm run build` already runs:

```bash
npx prisma migrate status          # must be clean, so the committed schema is a valid baseline
git show HEAD:prisma/schema.prisma > /tmp/base-schema.prisma
npx prisma migrate diff \
  --from-schema /tmp/base-schema.prisma \
  --to-schema prisma/schema.prisma \
  --script > prisma/migrations/<timestamp>_add_moods/migration.sql
```

On Prisma 7, `--to-schema-datamodel` no longer exists and `--from-migrations`
requires a `shadowDatabaseUrl`, so the baseline comes from git instead: local,
read-only, no connection. Cross-check the result against
`prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
(also read-only) so the substitution is validated rather than assumed.

Output, matching the `add_spoken_languages` migration's shape (Prisma emits one
`ALTER TABLE` with two clauses):

```sql
-- AlterTable
ALTER TABLE "Title" ADD COLUMN     "moods" TEXT[],
ADD COLUMN     "moodsTaggedAt" TIMESTAMP(3);
```

Both are additive and nullable, so existing rows are untouched. As with
`spokenLanguages`, a `TEXT[]` column added without a default reads back as `[]`
through Prisma for pre-existing rows, and `moodsTaggedAt IS NULL` is what
actually marks them as untagged. Confirm the generated SQL contains **only**
these two `ADD COLUMN` statements and no `DROP` (the retained
`RecommendationSet` / `DismissedTitle` models are exactly what keeps a drop from
appearing here; if the diff proposes dropping either table, the schema was
edited wrongly).

## 9. When tagging happens

`src/lib/moods.ts` is the single source of truth for the eleven moods (label +
slug), imported by the tagger, the validator, the picker, and the route.

| Trigger | Behaviour |
|---|---|
| **Add a title** (`POST /api/titles`) | After the upsert, tag it if `moodsTaggedAt` is null. |
| **Refresh a title** (`POST /api/titles/[id]/refresh`, and the staleness auto-refresh in `src/app/title/[id]/page.tsx`) | Same: tag only if `moodsTaggedAt` is null. |
| **Backfill script** | `npx tsx scripts/tag-all-moods.ts`, Want list first. |

Tagging applies **regardless of status**, so a title moving between Want and
Watched never needs re-tagging.

### Two rules that keep this safe

**1. Tag only when untagged.** The trigger is `moodsTaggedAt IS NULL`, not
"every refresh." This matters more than it looks: `refreshTitle()` is called
automatically from the title detail page whenever a row is older than 30 days
(`src/app/title/[id]/page.tsx` lines 9 to 15). Tagging on *every* refresh would
mean browsing twenty stale titles silently burns the entire daily Gemini quota
and slows every page load. Gating on `moodsTaggedAt` makes tagging idempotent
and bounded.

**2. Never block the response.** The tagging call is scheduled with `after()`
from `next/server`, which exists for exactly this (verified in
`node_modules/next/dist/docs/01-app/03-api-reference/04-functions/after.md`: it
runs after the response is finished, works in Route Handlers and Server
Components, and still runs if the response errored). A plain fire-and-forget
promise is **not** acceptable on Vercel, where the function can be frozen before
it settles. So "+ Add" stays as fast as it is today, and a Gemini timeout adds
zero latency to the user's action.

### The backfill script

`scripts/tag-all-moods.ts`, mirroring `scripts/refresh-all-titles.ts` in style:
the same `dotenv` + `.env.local` header, the same dynamic `import()` after
`config()` (because `prisma.ts` reads `DATABASE_URL` at module scope), the same
`[i/n]` progress logging, the same failure collection and end-of-run summary,
and the same "not wired into the app, run manually" docblock.

Differences specific to tagging:

- Selects `WHERE moodsTaggedAt IS NULL`, **Want first** (`orderBy: [{ status: "asc" }, { addedAt: "asc" }]` puts WANT before WATCHED), because Want is what is browsable.
- Walks in batches of 20 rather than one at a time.
- **Prints the running request count** as it goes (`request 7/16, 13 of the 20 daily budget used`), so remaining quota is visible during the run rather than worked out afterwards.
- Takes an optional `--limit N` (batches, not titles) so a run can be kept inside the remaining daily request budget.
- Stops early and says so on a `rate_limit` error, rather than grinding through sixteen guaranteed failures.
- **Paces requests at 15s** via the tagger's `INTER_REQUEST_DELAY_MS`, because the free tier also caps requests per MINUTE at 5 (section 7.1). A full Want run therefore takes ~4 minutes.

## 10. Error handling and degradation

Nothing here is on a user-blocking path, which is the point of pre-tagging.

| Situation | Behaviour |
|---|---|
| **A title genuinely matches no mood** | Allowed and expected to be rare. `moods = []`, `moodsTaggedAt = now()`. It appears under no mood, and is **not** counted as untagged. Never retried, because the answer was legitimate. |
| **A title is not yet tagged** | `moodsTaggedAt IS NULL`. It appears under no mood. The picker surfaces a quiet count ("12 titles not yet tagged") so an incomplete backfill is visible rather than looking like an empty list. |
| **Gemini fails, times out, or rate-limits during add or refresh** | Logged server-side and swallowed. The title stays untagged, the user's action already succeeded (it ran inside `after()`), and the backfill picks it up later. Never surfaced in the UI. |
| **Gemini returns malformed or truncated JSON** | The batch is a failure; the script records it and continues to the next batch. Those titles stay untagged. Reuses the existing breadcrumb logging (`finishReason` + `thoughts`/`candidates` token counts), which is precisely what catches a recurrence of thinking-token starvation. |
| **A response entry is malformed or misaligned** | That entry is dropped; the rest of the batch still writes (section 6). |
| **An unknown mood string comes back** | Dropped individually against the canonical eleven. A title whose every mood was invalid ends up as a legitimate empty tagging. |
| **A mood has no matching titles** | Clean empty state on the mood screen, not an error. The picker shows a `0` count, and a zero-count mood tile is visibly de-emphasised so the user rarely taps into an empty screen. |
| **An unknown mood slug in the URL** | `notFound()`. |

## 11. Screens and navigation

### Nav entry

A "Mood" `Link` to `/mood` in the right-side action group next to "+ Add",
occupying the slot the "For You" `Link` currently holds (`src/app/page.tsx`
lines 285 to 293), with the same subdued ghost styling so "+ Add" stays the
primary action. The existing comment explaining that this is "an action, not a
list tab" carries over with its route and label updated. Nothing else on Home
changes: no tab, filter, sort, or `listCache` behaviour is touched.

**The swap happens in two separate steps, not one.** The "For You" `Link` is
**removed outright** when its feature is removed, leaving no nav entry in that
slot, and the "Mood" `Link` is added later **alongside the screens it points
to.** Replacing the href in a single step would leave a Mood button live in
production, 404-ing, for as long as the intervening work takes. Changes here are
pushed and tested on the live site after every task, so "the build still
compiles" is not a sufficient bar: every deployed state has to be coherent on
its own. For that interval Home simply has one action button instead of two.

### `/mood`: the picker

A **server component**. One query fetches `{ id, moods, moodsTaggedAt }` for all
Want titles (327 rows), and counts are computed in JavaScript. That is one
query total, not eleven, and no `groupBy` gymnastics.

Visually, the app's restrained mono/editorial vocabulary: a grid of text tiles,
each with the mood label and its count in the existing `meta` style. **No
emoji.** Ordering follows section 5's canonical order rather than count, so the
grid does not reshuffle between visits. Zero-count tiles are de-emphasised but
still present, so the full vocabulary is always visible. Below the grid, the
untagged count when it is non-zero.

### `/mood/[slug]`: the results grid

Also a **server component**, taking `params: Promise<{ slug: string }>` and
awaiting it (the App Router convention this codebase already uses in
`src/app/title/[id]/page.tsx`). Slugs come from `src/lib/moods.ts`:
`light-funny`, `feel-good`, `tense-gripping`, `dark-heavy`, `thoughtful`,
`beautiful-calm`, `weird`, `big-thrilling`, `romantic`, `scary`, `conceptual`.
An unknown slug is `notFound()`.

The query is one line:

```ts
prisma.title.findMany({
  where: { status: "WANT", moods: { has: label } },
  orderBy: [{ pinned: "desc" }, { pinnedAt: "desc" }, { addedAt: "desc" }],
})
```

The ordering deliberately matches `listTitles()`'s Want ordering, so a title's
position feels consistent with Home.

The screen shows a `BackLink` to `/mood` (the same pattern Search uses), the
mood label as the heading, a match count, and the poster grid. A clean empty
state when the count is zero.

### Reusing TitleCard, and not reintroducing the poster flash

- **`TitleCard` is reused as-is.** Its poster setup is deliberate: the comment at `src/components/TitleCard.tsx` lines 32 to 36 records that a bisect proved `loading="lazy"` was what blanked the grid on back-navigation. **Do not add `loading="lazy"`, and do not change eagerness**, here or as a "while we're in there" improvement. If cold-load cost ever matters, the comment already prescribes the fix (make eagerness a prop), which is out of scope for this feature.
- **The grid classes are copied from Home**: `mt-2 grid grid-cols-3 gap-3 sm:grid-cols-4` (`src/app/page.tsx` line 402).
- **The `fade-in` class is deliberately NOT copied.** On Home it exists to cover client-side hydration of a `listCache`-warmed list. The mood grid is server-rendered HTML with no client fetch and no cached-state remount, so it paints complete on first frame. Adding a fade there would invent the very flash the class exists to hide.
- Cards link to `/title/${id}`, the existing detail page, unchanged. `TitleCard` has no `"use client"` directive, so it renders inside a server component without any wrapper.

Because both screens are server-rendered from the database with no client-side
fetching, there is no loading state, no cache-warming logic, and no remount
path. That is a direct consequence of the pre-tagging decision.

## 12. The shared Gemini module (extract, do not duplicate or lose)

`src/lib/recommend/gemini.ts` contains 234 lines of hard-won plumbing that took
real debugging to get right. The recommend feature's removal must **not** take it
down. It is extracted **first**, into `src/lib/gemini/client.ts`, before any
recommend code is deleted.

**Moves to `src/lib/gemini/client.ts` (behaviour-preserving):**

- `GEMINI_MODEL = "gemini-flash-latest"`, with its full comment about why the rolling alias is used and why pinned versions get retired.
- The `generateContent` endpoint URL and the `x-goog-api-key` **header** (not `?key=`).
- JSON mode via `generationConfig.responseMimeType` + `responseSchema`.
- The `AbortController` + timeout, and its timeout-versus-failure distinction via `controller.signal.aborted`.
- The typed error class with its `"timeout" | "rate_limit" | "failure"` discriminator, renamed to `GeminiError` / `GeminiErrorKind` since it is no longer recommendation-specific. The 429-to-`rate_limit` mapping and the non-200 body logging (which once unmasked a retired model id) come with it.
- The guarded accessors `extractText`, `getFinishReason`, `summarizeUsage`, including the `thoughtsTokenCount` breadcrumb that is the tell for thinking-token starvation.
- `MAX_OUTPUT_TOKENS = 8192` as the default, with its comment intact, overridable per call.

Shape, so both the mood tagger and any future caller share one path:

```ts
export async function generateJson(opts: {
  prompt: string;
  responseSchema: object;
  logPrefix: string;              // "[mood]", was "[recommend]"
  temperature?: number;
  maxOutputTokens?: number;       // default 8192
  timeoutMs?: number;             // default 20_000
}): Promise<unknown>;             // parsed JSON; throws GeminiError on real failure
```

**Deleted with the recommend feature** (genuinely recommendation-specific): the
rating-history prompt builder, `RESPONSE_SCHEMA` for suggestions,
`coerceSuggestion` / `coerceSuggestions`, and the `TARGET_COUNT` /
`REASON_MAX_LEN` constants.

**Test coverage must be ported, not lost.** `src/lib/recommend/__tests__/gemini.test.ts`
(176 lines) covers non-200 handling, malformed JSON, abort/timeout, and the
guarded extraction paths. Those cases move to
`src/lib/gemini/__tests__/client.test.ts` against `generateJson` **before** the
recommend tests are deleted, so the suite never loses that coverage. Deleting
those 176 lines without porting them would silently drop the only protection on
the trickiest code in the project.

## 13. Privacy

Only film metadata leaves the app. For each title being tagged: **title, year,
media type, genres, and a truncated overview.** That is all.

**Never sent:** `myRating`, personal notes, the passcode, `DATABASE_URL` or any
credential, environment values, watch dates, pinned state, or any device
identifier.

Worth noting explicitly as an improvement over what is being removed: the "For
You" feature sent the owner's **personal ratings** to Gemini, because taste
inference required them. Mood tagging needs nothing personal at all. It sends
only facts about the film that TMDb already published, so the personal layer of
the library never leaves the device.

As with the recommend provider, the request is assembled from an explicit
whitelist (`TaggableTitle`, section 6), never by serializing a `Title` row, so a
field added to `Title` later cannot leak through this path.

## 14. Secrets and configuration

**No new environment variables.** `GEMINI_API_KEY` already exists in
`.env.local`, `.env.example`, and Vercel, and is read only as
`process.env.GEMINI_API_KEY`. Per the project's Vercel lesson it stays a normal
variable, not marked "Sensitive."

## 15. Scope

**In:** removal of the For You feature (code only); extraction of the shared
Gemini client; `moods` + `moodsTaggedAt` on `Title` with an additive migration;
the mood tagging service with batch size 20, validation, and tests; tag-on-add
and tag-on-refresh via `after()`, gated on untagged; the `scripts/tag-all-moods.ts`
backfill; `/mood` picker and `/mood/[slug]` grid, with the "Mood" nav entry
added alongside them into the slot "For You" vacated; counts, empty states, and
the untagged count.

**Deliberately deferred:**

- **Dropping `RecommendationSet` and `DismissedTitle`.** Code-only removal now, destructive migration later, on purpose (section 3).
- **Mood browsing over Watched.** Titles are already tagged regardless of status, so this is a filter change with no re-tagging cost.
- **Manual mood editing** (overriding the model on a title).
- **Re-tagging after a prompt revision.** The mechanism already exists: clear `moodsTaggedAt`, re-run the backfill.
- **A GIN index on `moods`**, until the library is an order of magnitude larger.
- **Mood combinations** ("tense AND thoughtful"). One mood at a time reads better on a phone and covers the actual use case.

## 16. Build phases

- **Phase 1: Remove For You, extract the Gemini client.** Extract `src/lib/gemini/client.ts` with ported tests, then delete the recommend feature's code and tests. The "For You" nav entry is removed outright, with no replacement.
- **Phase 2: Schema and migration.** `moods` + `moodsTaggedAt`, migration by the diff method, verify only two `ADD COLUMN` statements.
- **Phase 3: Tagging service.** `src/lib/moods.ts` canonical list, the prompt with all eleven definitions, batching at 20, validation, unit tests against a mocked client.
- **Phase 4: Triggers and backfill.** `after()`-scheduled tagging on add and refresh gated on `moodsTaggedAt`, plus `scripts/tag-all-moods.ts`. Deploy on a fresh daily quota and run the real backfill without browsing in between.
- **Phase 5: The screens and the nav entry.** `/mood` picker, `/mood/[slug]` grid, the "Mood" nav entry added alongside them, `TitleCard` reused as-is.
- **Phase 6: Polish and phone check.** Counts, empty states, untagged count, tap targets, on-device verification.
