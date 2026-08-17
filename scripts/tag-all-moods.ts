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
 *   npx tsx scripts/tag-all-moods.ts --limit 5  # at most 5 requests
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
    console.error("--limit needs a positive whole number of requests");
    process.exit(1);
  }
  return { all, dryRun, model, limit: limitFlag >= 0 ? limit : null };
}

async function main() {
  const { all, dryRun, model, limit } = parseArgs(process.argv.slice(2));

  // Dynamic import: prisma.ts reads process.env.DATABASE_URL at module scope,
  // so it must load after dotenv has populated process.env above — a static
  // import would be hoisted ahead of that config() call.
  const { prisma } = await import("../src/lib/prisma");
  const { tagTitles, TAG_BATCH_SIZE, INTER_REQUEST_DELAY_MS } = await import("../src/lib/mood/tagger");
  const { GeminiError, resolveModel, GEMINI_MODEL } = await import("../src/lib/gemini/client");
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
  if (plannedRequests > DAILY_REQUEST_CAP) {
    console.log(`WARNING: ${plannedRequests} requests exceeds the ${DAILY_REQUEST_CAP}/day free-tier cap; the tail will rate-limit.`);
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

  let rateLimited = false;
  const started = process.hrtime.bigint();

  let result = { tagged: 0, failed: 0, requests: 0, model: servingModel, abortedAfterConsecutiveFailures: false };
  try {
    result = await tagTitles(
      targets.map((t) => t.id),
      {
        model,
        onRequest: ({ requestNumber, totalRequests, batchSize, elapsedMs, sinceLastMs }) => {
          const left = Math.max(0, DAILY_REQUEST_CAP - requestNumber);
          const at = `t+${(elapsedMs / 1000).toFixed(0)}s`;
          // The gap is the pacing delay plus the previous response time, so a
          // gap comfortably above 12s is the per-minute cap being respected.
          const gap = sinceLastMs == null ? "first" : `gap ${(sinceLastMs / 1000).toFixed(1)}s`;
          console.log(
            `[${requestNumber}/${totalRequests}] ${at}, ${gap} — tagging ${batchSize} titles, ` +
              `${requestNumber} of the ${DAILY_REQUEST_CAP} daily budget used, ${left} remaining`,
          );
        },
      },
    );
  } catch (e) {
    if (e instanceof GeminiError && e.kind === "rate_limit") {
      rateLimited = true;
      // A 429 can be either cap, and the two mean opposite things here.
      console.log("\nSTOPPED: Gemini returned 429. That is either cap, and which one matters:");
      console.log(`  - ${DAILY_REQUEST_CAP}/day exhausted: expected near the end of a full run. Re-run after the daily reset.`);
      console.log(`  - ${PER_MINUTE_CAP}/minute exceeded: the ${INTER_REQUEST_DELAY_MS / 1000}s pacing is too short, or something else is calling Gemini concurrently. Raise INTER_REQUEST_DELAY_MS.`);
      console.log("  The [mood] non-200 body logged above names the quota that was hit.");
      console.log("  Either way this run resumed-safe: re-running continues from the untagged rows.");
    } else {
      throw e;
    }
  }

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
  console.log(`Tagged ${result.tagged}, failed ${result.failed}, using ${result.requests} request(s).`);
  if (result.abortedAfterConsecutiveFailures) {
    console.log(`  STOPPED EARLY: ${servingModel} failed 3 batches in a row, so the run gave up rather than`);
    console.log(`  spending the rest of the budget on it. Rate limits are per model, so retry with`);
    console.log(`  --model on a different one (e.g. gemini-3.5-flash, or a Lite variant for a far larger quota).`);
  }
  console.log(`  ${withMoods} ${scope} titles now carry at least one mood.`);
  console.log(`  ${noMoodMatched} were tagged but matched no mood (allowed, and never retried).`);
  console.log(`  ${remaining} still untagged${rateLimited ? " (rate limit hit)" : ""}.`);
  if (remaining > 0 && !rateLimited) {
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
