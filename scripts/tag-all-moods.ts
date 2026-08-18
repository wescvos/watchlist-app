/**
 * One-off backfill: mood-tags every title that has never been tagged, so the
 * Mood screen has something to show. Reuses tagTitles() as-is, so batching,
 * the privacy whitelist, the alignment guard, and the validation rules are the
 * same ones the app uses at add/refresh time. Nothing is duplicated here.
 *
 * QUOTA. The Gemini free tier caps requests two ways: 20 per DAY and 5 per
 * MINUTE. This script spends one request per batch of 20 titles, so the Want
 * list alone is ~17 requests, most of a day's budget, and far too many to fire
 * back to back:
 *
 *   - Defaults to WANT ONLY. Want is what the Mood screen browses, and adding
 *     the Watched titles would need ~11 more requests than the cap allows.
 *     Pass --all to include Watched, on a day when the budget is free.
 *   - Paces requests via the tagger's INTER_REQUEST_DELAY_MS to stay under the
 *     per-minute cap. A full run therefore takes minutes, by design.
 *   - Prints the running request count, elapsed time, and the gap between
 *     requests, so both the budget and the pacing are visible live.
 *   - Counts REAL requests, retries included, and stops at --budget BEFORE a 429
 *     rather than discovering the cap by hitting it. Counting batches instead is
 *     what once let a run report "10 of 20 used" while all 20 were gone.
 *   - Stops immediately on a rate limit and reports what is left, rather than
 *     grinding through guaranteed failures.
 *   - Resumable by construction: it selects moodsTaggedAt IS NULL, so
 *     re-running continues rather than restarting.
 *
 * MODEL. Rate limits are PER MODEL, so switching models means a fresh daily
 * budget. That matters when the rolling `gemini-flash-latest` alias lands on an
 * unstable version: on 2026-08-17 it rolled onto Gemini 3.7 Flash the day that
 * model shipped, every request 503'd with "high demand", and the failed requests
 * still counted against 3.7's quota. Passing --model pins this run to a
 * known-good version with an untouched budget. Prefer the alias normally; pin
 * deliberately when the alias is unstable, and drop the flag once it settles.
 *
 * Not wired into the app. Run manually:
 *   npx tsx scripts/tag-all-moods.ts --dry-run  # print the plan, spend nothing
 *   npx tsx scripts/tag-all-moods.ts            # Want only, rolling alias
 *   npx tsx scripts/tag-all-moods.ts --limit 5   # at most 5 batches
 *   npx tsx scripts/tag-all-moods.ts --budget 8  # spend at most 8 real requests
 *   npx tsx scripts/tag-all-moods.ts --all      # Want and Watched
 *   npx tsx scripts/tag-all-moods.ts --model gemini-3.6-flash   # pin this run
 *
 * --dry-run exists because the real run is effectively one-shot against a
 * day's budget: it proves the selection, the scope, and the request count
 * before any of that budget is committed.
 */
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");

config({ path: path.join(ROOT, ".env.local") });

// Free-tier caps, for the budget lines in the output only. The pacing that
// actually respects the per-minute cap lives in the tagger.
const DAILY_REQUEST_CAP = 20;
const PER_MINUTE_CAP = 5;

function parseArgs(argv: string[]) {
  const all = argv.includes("--all");
  const dryRun = argv.includes("--dry-run");
  const modelFlag = argv.indexOf("--model");
  const model = modelFlag >= 0 ? argv[modelFlag + 1] : undefined;
  if (modelFlag >= 0 && (!model || model.startsWith("--"))) {
    console.error("--model needs a model id, e.g. gemini-3.6-flash");
    process.exit(1);
  }
  const limitFlag = argv.indexOf("--limit");
  const limit = limitFlag >= 0 ? Number(argv[limitFlag + 1]) : NaN;
  if (limitFlag >= 0 && (!Number.isInteger(limit) || limit < 1)) {
    console.error("--limit needs a positive whole number of batches");
    process.exit(1);
  }
  const budgetFlag = argv.indexOf("--budget");
  const budgetArg = budgetFlag >= 0 ? Number(argv[budgetFlag + 1]) : NaN;
  if (budgetFlag >= 0 && (!Number.isInteger(budgetArg) || budgetArg < 1)) {
    console.error("--budget needs a positive whole number of requests");
    process.exit(1);
  }
  return {
    all,
    dryRun,
    model,
    limit: limitFlag >= 0 ? limit : null,
    // Requests this run may spend, retries included. Defaults to the full daily
    // cap; pass a lower number when part of today's quota is already gone.
    budget: budgetFlag >= 0 ? budgetArg : DAILY_REQUEST_CAP,
  };
}

async function main() {
  const { all, dryRun, model, limit, budget } = parseArgs(process.argv.slice(2));

  // Dynamic import: prisma.ts reads process.env.DATABASE_URL at module scope,
  // so it must load after dotenv has populated process.env above — a static
  // import would be hoisted ahead of that config() call.
  const { prisma } = await import("../src/lib/prisma");
  const { tagTitles, TAG_BATCH_SIZE, INTER_REQUEST_DELAY_MS, DEFAULT_TAG_RETRY_DELAYS } = await import("../src/lib/mood/tagger");
  const { resolveModel, GEMINI_MODEL } = await import("../src/lib/gemini/client");
  const servingModel = resolveModel(model);

  const where = all
    ? { moodsTaggedAt: null }
    : { moodsTaggedAt: null, status: "WANT" as const };

  const untagged = await prisma.title.findMany({
    where,
    select: { id: true, title: true },
    // Want before Watched (WANT sorts first), oldest first within each.
    orderBy: [{ status: "asc" }, { addedAt: "asc" }],
  });

  const scope = all ? "Want and Watched" : "Want to watch";
  if (untagged.length === 0) {
    console.log(`Nothing to tag: every ${scope} title already has moods.`);
    return;
  }

  // A --limit caps REQUESTS, so translate it into how many titles this run takes.
  const maxTitles = limit != null ? limit * TAG_BATCH_SIZE : untagged.length;
  const targets = untagged.slice(0, maxTitles);
  const plannedRequests = Math.ceil(targets.length / TAG_BATCH_SIZE);

  // Pacing means the run takes minutes; say so up front rather than looking hung.
  const etaSeconds = Math.round(((plannedRequests - 1) * INTER_REQUEST_DELAY_MS) / 1000);
  console.log(`Model: ${servingModel}${servingModel === GEMINI_MODEL ? " (rolling alias)" : " (PINNED for this run)"}`);
  console.log(`Untagged ${scope} titles: ${untagged.length}`);
  console.log(`Tagging ${targets.length} of them in ${plannedRequests} request(s) of up to ${TAG_BATCH_SIZE}.`);
  console.log(
    `Paced at ${INTER_REQUEST_DELAY_MS / 1000}s between requests to stay under the ${PER_MINUTE_CAP}/minute cap, ` +
      `so expect at least ~${Math.floor(etaSeconds / 60)}m ${etaSeconds % 60}s plus response time.`,
  );
  // BATCHES ARE NOT REQUESTS. Every attempt is billable, so a batch costs 1
  // request when it succeeds first time and up to 1 + retries when it does not.
  // Reporting only batches is what hid real usage until a 429 landed.
  const maxAttemptsPerBatch = 1 + DEFAULT_TAG_RETRY_DELAYS.length;
  const worstCaseRequests = plannedRequests * maxAttemptsPerBatch;
  console.log(
    `Request budget: ${budget} (retries included). Best case ${plannedRequests} request(s), ` +
      `worst case ${worstCaseRequests} at up to ${maxAttemptsPerBatch} attempt(s) per batch.`,
  );
  if (worstCaseRequests > budget) {
    console.log(
      `NOTE: with retries this run could hit the ${budget}-request budget before finishing all ` +
        `${plannedRequests} batches. It will stop cleanly at the budget and leave the rest for the next run.`,
    );
  }
  if (targets.length < untagged.length) {
    console.log(`(--limit ${limit}: leaving ${untagged.length - targets.length} for a later run.)`);
  }
  if (!all) {
    const watched = await prisma.title.count({ where: { moodsTaggedAt: null, status: "WATCHED" } });
    if (watched > 0) console.log(`(Skipping ${watched} untagged Watched titles. Pass --all on a free-budget day.)`);
  }
  if (dryRun) {
    console.log("\nDRY RUN. Nothing sent to Gemini, no quota spent, no rows written.");
    console.log(`First titles that would be tagged, in order:`);
    for (const t of targets.slice(0, 5)) console.log(`  - ${t.title}`);
    if (targets.length > 5) console.log(`  ... and ${targets.length - 5} more`);
    return;
  }

  console.log("");

  const started = process.hrtime.bigint();

  // tagTitles no longer throws on a rate limit: it stops, records why, and
  // returns real counters. The old version threw, which discarded every counter
  // and printed "Tagged 0, failed 0, using 0 request(s)" straight above DB
  // counts proving otherwise.
  const result = await tagTitles(
    targets.map((t) => t.id),
    {
      model,
      requestBudget: budget,
      onRequest: ({ requestNumber, totalRequests, batchSize, requestsSpent, elapsedMs, sinceLastMs }) => {
        const left = Math.max(0, budget - requestsSpent);
        const at = `t+${(elapsedMs / 1000).toFixed(0)}s`;
        // The gap is the pacing delay plus the previous response time, so a
        // gap comfortably above 12s is the per-minute cap being respected.
        const gap = sinceLastMs == null ? "first" : `gap ${(sinceLastMs / 1000).toFixed(1)}s`;
        console.log(
          `[batch ${requestNumber}/${totalRequests}] ${at}, ${gap} — tagging ${batchSize} titles, ` +
            `${requestsSpent} of ${budget} REQUESTS spent, ${left} left`,
        );
      },
    },
  );

  const seconds = Number(process.hrtime.bigint() - started) / 1e9;

  // Counted from the DB rather than arithmetic: titles the model simply omitted
  // are neither tagged nor failed, and only the database knows the truth.
  const remaining = await prisma.title.count({ where });
  const withMoods = await prisma.title.count({
    where: all ? { moods: { isEmpty: false } } : { status: "WANT", moods: { isEmpty: false } },
  });
  const noMoodMatched = await prisma.title.count({
    where: all
      ? { moodsTaggedAt: { not: null }, moods: { isEmpty: true } }
      : { status: "WANT", moodsTaggedAt: { not: null }, moods: { isEmpty: true } },
  });

  console.log("\n" + "=".repeat(60));
  console.log(`Done in ${seconds.toFixed(1)}s on model ${result.model}.`);
  console.log(
    `Tagged ${result.tagged}, failed ${result.failed}, across ${result.batches} batch(es) ` +
      `using ${result.requests} REAL request(s) (retries included).`,
  );
  if (result.requests > result.batches) {
    console.log(
      `  ${result.requests - result.batches} of those were retries. Every attempt counts against the daily cap,`,
    );
    console.log("  which is why this line reports requests rather than batches.");
  }
  if (result.stoppedReason === "consecutive_failures") {
    console.log(`  STOPPED EARLY: ${servingModel} failed 3 batches in a row, so the run gave up rather than`);
    console.log(`  spending the rest of the budget on it. Rate limits are per model, so retry with`);
    console.log(`  --model on a different one (e.g. gemini-3.5-flash, or a Lite variant for a far larger quota).`);
  } else if (result.stoppedReason === "rate_limit") {
    console.log(`  STOPPED EARLY: a 429 on ${servingModel} after ${result.requests} real request(s).`);
    console.log(`  - ${DAILY_REQUEST_CAP}/day exhausted for this MODEL: switch models or wait for the reset.`);
    console.log(`  - ${PER_MINUTE_CAP}/minute exceeded: pacing is ${INTER_REQUEST_DELAY_MS / 1000}s, so this is unlikely`);
    console.log(`    unless something else is calling Gemini at the same time.`);
    console.log("  The [mood] non-200 body logged above names which quota was hit.");
  } else if (result.stoppedReason === "budget_exhausted") {
    console.log(`  STOPPED CLEANLY at the ${budget}-request budget, before a 429 rather than because of one.`);
    console.log(`  Re-run after the daily reset, or with --model on a model that has quota left.`);
  }
  console.log(`  ${withMoods} ${scope} titles now carry at least one mood.`);
  console.log(`  ${noMoodMatched} were tagged but matched no mood (allowed, and never retried).`);
  console.log(`  ${remaining} still untagged${result.stoppedReason ? ` (stopped: ${result.stoppedReason})` : ""}.`);
  if (remaining > 0 && !result.stoppedReason) {
    console.log("  Re-run to pick those up: titles the model omitted stay untagged by design.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    const { prisma } = await import("../src/lib/prisma");
    await prisma.$disconnect();
  });
