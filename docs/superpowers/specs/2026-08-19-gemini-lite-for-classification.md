# Gemini Flash Lite for mood classification: decision record

**Date:** 2026-08-19
**Status:** Decided and applied. All 532 library titles tagged on `gemini-3.5-flash-lite`.
**Companion:** `2026-08-14-mood-design.md` (the feature), `../plans/2026-08-14-mood.md` (the plan)

## Decision

Mood tagging backfills run on **`gemini-3.5-flash-lite`**. The app's default stays
the rolling `gemini-flash-latest` alias; only backfill scripts pin a model, per
run, via `--model`.

This is recorded because the obvious instinct is to reject Lite for a
judgement-heavy task, and re-deriving why that instinct was tested rather than
followed costs a day of quota.

## Why we moved off full Flash

Not preference. Availability.

| Date | Model | Outcome |
|---|---|---|
| 2026-08-17 | `gemini-3.7-flash` (via the alias, on its release day) | 16 of 17 batches 503'd "high demand" |
| 2026-08-18 | `gemini-3.6-flash` | 4 of 5 batches aborted on a 20s timeout, since raised to 120s |
| 2026-08-18 | `gemini-3.5-flash` | Full backfill succeeded, 287 titles in 15 requests |
| 2026-08-19 | `gemini-3.5-flash` | Drained 20/20 RPD, ~140 titles tagged |
| 2026-08-19 | `gemini-3.7-flash` (fresh 0/20) | 4 of 6 batches 503'd, 40 titles for 12 requests |

Persistent 503s across **three** full Flash models over **three** days, including
one on a completely fresh daily budget, is a pattern rather than a spike.

Two properties of the free tier turn that into a hard blocker:

1. **Failed requests are billable.** A 503 costs a request against 20/day, so an unavailable model drains the budget while doing nothing.
2. **Retries multiply the damage.** With most batches needing 2-3 attempts, a 17-batch run spends 34-51 requests against a cap of 20.

Efficiency on 2026-08-19 was **3.3 titles per request** against **19** on the
healthy 3.5 run. Finishing 328 titles that way was not viable.

Lite's caps are **500/day and 15/minute**, against 20 and 5. At 25x the daily
budget, retries and failures stop being scarce resources.

## How Lite was evaluated

Not by argument. A **40-title probe** (2 of 500 requests), audited against the
checks that actually matter for this task, with the full 40 mappings read by hand
because n=40 is too small for distribution statistics to decide anything.

The probe's aggregate figures were explicitly treated as low-confidence, and that
caution paid off: Thoughtful looked inflated at 38%, and at full scale it came
back at 28% against full Flash's 25%. **Tuning on the probe's numbers would have
overcorrected a mood that was fine.**

## The evidence, at full scale (328 Want titles)

### The instruction most likely to be dropped, held

The `PREFER ONE` rule separating Slow-burn dread from Edge-of-seat is the
subtlest thing in the prompt, and a weaker model dropping it was the main risk.

| | |
|---|---|
| Slow-burn dread | 64 (20%) |
| Edge-of-seat | 86 (26%) |
| **Both** | **4 (1%)** |

All four "both" titles are TV series (Lurker, FROM, Mr. Mercedes, The Americans),
which is exactly the case the "only when a film genuinely sustains both registers
throughout" clause exists for. The 1% is the escape hatch being used correctly,
not slop.

Supporting: dread without Scary **52/64** (dread is read as a tone, not horror);
Edge-of-seat without Big & thrilling **75/86** (stakes, not scale).

### Discrimination controls match full Flash

The question these answer is "is it reading films, or mapping genres?"

| Control | Lite | Full Flash |
|---|---|---|
| Comedy genre → Light & funny | 43/67 (**64%**) | **64%** |
| Horror genre → Scary | 21/36 (58%) | 64% |
| Horror tagged ONLY Scary and/or Dark & heavy (the lazy pattern) | 1/36 | 0/36 |

Identical on the comedy control. If it were rubber-stamping genres, the first two
would be near 100% and the third would be most of the horror titles.

### Conceptual precision: 93%

46 of 328 (14%), against 12% on full Flash. **43 defensible, 3 wrong**: The Big
Short, Side Effects, The Life of David Gale. The latter two are twisty thrillers
whose twist is a plot reveal, which the definition already excludes explicitly.

Left unfixed deliberately. The rule is written, more words rarely move a
judgement boundary, and chasing the last 7% risks overcorrecting something that
works. 93% on a subjective distinction is a good place to stop.

### Distribution stability

Dark & heavy 31% (was 32%), Romantic 13% (13%), Scary 8% (9%), Light & funny 15%
(14%), Feel-good 11% (10%). Moods per title: 80 single, 178 double, 65 triple, 4
quadruple, mirroring full Flash's spread. Weird fell to 12% from 17% and
Beautiful & calm to 9% from 12%, the only notable declines.

## What made this decision cheap to reverse

The asymmetry that actually decided it: **on Lite, being wrong is cheap to fix.**
A full re-tag of all 532 titles costs ~28 of 500 daily requests and about five
minutes. On full Flash it cost an entire day's budget and frequently failed. So
the downside of a Lite mistake is an afternoon, while the downside of waiting was
indefinite.

That is the general lesson: **the cost of iterating on a decision belongs in the
decision.** A model that is slightly worse but 25x cheaper to re-run can be the
better engineering choice even for judgement-heavy work.

## Final state

| | |
|---|---|
| Want titles tagged | 328 / 328, one matched no mood |
| Watched titles tagged | 204 / 204, one matched no mood |
| Requests spent | 2 probe + 17 Want + 11 Watched = **30 of 500** |
| Failures | 0 across all three runs |
| Wall clock | ~5 minutes total |

Every title in the library is now judged by one model against one vocabulary,
which is why the re-tag covered the whole Want list rather than only the untagged
remainder. Mood browsing over the Watched list is now a pure filter change with
no tagging run attached.

## If this needs revisiting

- **Full Flash recovers.** Nothing here is irreversible: drop `--model` and the alias is used again. Re-tagging to compare is ~28 requests.
- **Quality drifts on a new Lite version.** Lite ids are versioned (`3.5`, `3.1`), so they do not move underneath us the way the alias does. A deliberate bump should be re-probed with the same 40-title method.
- **The prompt changes.** Any vocabulary change already requires a full re-tag (see `src/lib/moods.ts`), which is now inexpensive.
