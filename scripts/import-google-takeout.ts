/**
 * One-off Google Takeout importer. Reads import/Watched.json (already-watched
 * titles) and import/want-to-watch*.csv (want-to-watch titles), matches each
 * against TMDb, and reports what would be imported. Nothing is written to
 * the database unless run with --commit.
 *
 * Usage:
 *   npx tsx scripts/import-google-takeout.ts             # dry run (default)
 *   npx tsx scripts/import-google-takeout.ts --commit     # actually import
 */
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";
import { parse } from "csv-parse/sync";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const IMPORT_DIR = path.join(ROOT, "import");

config({ path: path.join(ROOT, ".env.local") });

// Safe to import statically: this module doesn't touch process.env at module scope.
import { searchTitles } from "../src/lib/tmdb";
import type { SearchResult } from "../src/lib/types";
// Title-to-TMDb matching now lives in a shared module so the Recommended
// feature's resolver reuses the exact same discipline (see src/lib/tmdbMatch.ts).
import { normalize, evaluateMatch, type MatchOutcome } from "../src/lib/tmdbMatch";

const COMMIT = process.argv.includes("--commit");
const SEARCH_DELAY_MS = 300;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- input parsing -----------------------------------------------------------

interface WatchedEntry {
  title: string;
  watchedAt: Date;
}

interface WantEntry {
  title: string;
}

function readWatchedJson(): WatchedEntry[] {
  const filePath = path.join(IMPORT_DIR, "Watched.json");
  if (!fs.existsSync(filePath)) {
    console.error(`Missing ${filePath}`);
    process.exit(1);
  }
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8")) as Array<{ Published: string; "Search Query": string }>;

  const byNormalized = new Map<string, WatchedEntry>();
  for (const row of raw) {
    const title = (row["Search Query"] ?? "").trim();
    const published = row.Published;
    if (!title || !published) continue;
    const watchedAt = new Date(published);
    if (Number.isNaN(watchedAt.getTime())) continue;
    const key = normalize(title);
    const existing = byNormalized.get(key);
    if (!existing || watchedAt > existing.watchedAt) {
      byNormalized.set(key, { title, watchedAt });
    }
  }
  return [...byNormalized.values()];
}

function readWantCsvs(): WantEntry[] {
  const files = fs
    .readdirSync(IMPORT_DIR)
    .filter((f) => /^want-to-watch.*\.csv$/i.test(f));
  if (files.length === 0) {
    console.error(`No want-to-watch*.csv files found in ${IMPORT_DIR}`);
    process.exit(1);
  }

  const byNormalized = new Map<string, WantEntry>();
  for (const file of files) {
    const content = fs.readFileSync(path.join(IMPORT_DIR, file), "utf8");
    const rows = parse(content, { columns: true, skip_empty_lines: true, trim: true }) as Array<Record<string, string>>;
    for (const row of rows) {
      const title = (row.Title ?? "").trim();
      if (!title) continue;
      const key = normalize(title);
      if (!byNormalized.has(key)) byNormalized.set(key, { title });
    }
  }
  return [...byNormalized.values()];
}

// --- report accumulation -------------------------------------------------------

interface ReviewItem {
  source: "watched" | "want";
  title: string;
  reason: string;
}

// One-off manual correction: the tiebreak's popularity fallback picked the
// 2013 TV series over the 2001 film despite the film having more total votes
// (5231 vs 2968) — the two signals disagreed, and the user confirmed the
// film is the one meant.
const MANUAL_OVERRIDES: Record<string, { tmdbId: number; mediaType: "MOVIE" | "TV" }> = {
  hannibal: { tmdbId: 9740, mediaType: "MOVIE" },
};

function applyManualOverride(title: string, match: MatchOutcome): MatchOutcome {
  const override = MANUAL_OVERRIDES[normalize(title)];
  if (!override || !match.candidate) return match;
  return {
    ...match,
    candidate: { ...match.candidate, tmdbId: override.tmdbId, mediaType: override.mediaType },
    reason: `${match.reason ?? ""} [manually overridden to ${override.mediaType} id ${override.tmdbId} per user correction]`.trim(),
  };
}

interface ConfirmedItem {
  source: "watched" | "want";
  title: string;
  candidate: SearchResult;
  watchedAt?: Date;
  tiebreakNote?: string;
}

async function resolveAgainstTmdb(title: string): Promise<SearchResult[]> {
  const results = await searchTitles(title);
  await sleep(SEARCH_DELAY_MS);
  return results;
}

async function main() {
  // Dynamic import: prisma.ts reads process.env.DATABASE_URL at module scope
  // (via `new PrismaPg({ connectionString: ... })`), so it must load after
  // dotenv has populated process.env above — a static import would be hoisted
  // ahead of that config() call.
  const { prisma } = await import("../src/lib/prisma");
  const { addTitle } = await import("../src/lib/titles");
  const { Status } = await import("@prisma/client");

  const watched = readWatchedJson();
  const want = readWantCsvs();
  const watchedKeys = new Set(watched.map((w) => normalize(w.title)));

  console.log(`Loaded ${watched.length} unique watched titles, ${want.length} unique want-to-watch titles.\n`);

  const review: ReviewItem[] = [];
  const confirmed: ConfirmedItem[] = [];
  const tiebreak: ConfirmedItem[] = [];
  let skippedAlreadyWatched = 0;

  console.log("Matching watched titles against TMDb...");
  for (const entry of watched) {
    const results = await resolveAgainstTmdb(entry.title);
    const match = applyManualOverride(entry.title, evaluateMatch(entry.title, results));
    if (match.outcome === "confident" && match.candidate) {
      confirmed.push({ source: "watched", title: entry.title, candidate: match.candidate, watchedAt: entry.watchedAt });
    } else if (match.outcome === "tiebreak" && match.candidate) {
      tiebreak.push({ source: "watched", title: entry.title, candidate: match.candidate, watchedAt: entry.watchedAt, tiebreakNote: match.reason });
    } else {
      review.push({ source: "watched", title: entry.title, reason: match.reason ?? "unknown" });
    }
  }

  console.log("Matching want-to-watch titles against TMDb...");
  for (const entry of want) {
    if (watchedKeys.has(normalize(entry.title))) {
      skippedAlreadyWatched++;
      continue;
    }
    const results = await resolveAgainstTmdb(entry.title);
    const match = applyManualOverride(entry.title, evaluateMatch(entry.title, results));
    if (match.outcome === "confident" && match.candidate) {
      confirmed.push({ source: "want", title: entry.title, candidate: match.candidate });
    } else if (match.outcome === "tiebreak" && match.candidate) {
      tiebreak.push({ source: "want", title: entry.title, candidate: match.candidate, tiebreakNote: match.reason });
    } else {
      review.push({ source: "want", title: entry.title, reason: match.reason ?? "unknown" });
    }
  }

  // Dedupe by resolved TMDb target (different input titles can resolve to the
  // same title) and check what's already in the library. Shared seenTargets
  // set spans both tiers so a title resolved confidently elsewhere doesn't
  // also get queued from the tiebreak tier.
  const seenTargets = new Set<string>();
  let alreadyInLibrary = 0;
  let duplicateTarget = 0;

  async function resolveImportList(items: ConfirmedItem[]): Promise<ConfirmedItem[]> {
    const result: ConfirmedItem[] = [];
    for (const item of items) {
      const key = `${item.candidate.mediaType}:${item.candidate.tmdbId}`;
      if (seenTargets.has(key)) {
        duplicateTarget++;
        continue;
      }
      seenTargets.add(key);
      const existing = await prisma.title.findUnique({
        where: { tmdbId_mediaType: { tmdbId: item.candidate.tmdbId, mediaType: item.candidate.mediaType } },
        select: { id: true },
      });
      if (existing) {
        alreadyInLibrary++;
        continue;
      }
      result.push(item);
    }
    return result;
  }

  const toImportConfirmed = await resolveImportList(confirmed);
  const toImportTiebreak = await resolveImportList(tiebreak);

  const confirmedWatched = toImportConfirmed.filter((i) => i.source === "watched");
  const confirmedWant = toImportConfirmed.filter((i) => i.source === "want");
  const tiebreakWatched = toImportTiebreak.filter((i) => i.source === "watched");
  const tiebreakWant = toImportTiebreak.filter((i) => i.source === "want");
  const reviewWatched = review.filter((r) => r.source === "watched");
  const reviewWant = review.filter((r) => r.source === "want");

  console.log("\n" + "=".repeat(60));
  console.log(COMMIT ? "COMMIT MODE — writing to the database" : "DRY RUN — nothing will be written (pass --commit to import)");
  console.log("=".repeat(60));

  console.log(`\nConfident matches ready to import: ${toImportConfirmed.length}`);
  console.log(`  - Watched: ${confirmedWatched.length}`);
  console.log(`  - Want to watch: ${confirmedWant.length}`);

  console.log(`\nTiebreak matches (popularity/vote-count dominance) ready to import: ${toImportTiebreak.length}`);
  console.log(`  - Watched: ${tiebreakWatched.length}`);
  console.log(`  - Want to watch: ${tiebreakWant.length}`);
  if (toImportTiebreak.length > 0) {
    console.log("\n--- Tiebreak picks (watched) ---");
    for (const t of tiebreakWatched) console.log(`  "${t.title}" — ${t.tiebreakNote}`);
    console.log("\n--- Tiebreak picks (want to watch) ---");
    for (const t of tiebreakWant) console.log(`  "${t.title}" — ${t.tiebreakNote}`);
  }

  console.log(`\nAlready in library (skipped): ${alreadyInLibrary}`);
  console.log(`Duplicate TMDb target within this run (skipped): ${duplicateTarget}`);
  console.log(`Want-to-watch titles skipped (already in Watched list): ${skippedAlreadyWatched}`);
  console.log(`\nStill needs review: ${review.length}`);
  console.log(`  - Watched: ${reviewWatched.length}`);
  console.log(`  - Want to watch: ${reviewWant.length}`);

  if (review.length > 0) {
    console.log("\n--- Needs review (watched) ---");
    for (const r of reviewWatched) console.log(`  "${r.title}" — ${r.reason}`);
    console.log("\n--- Needs review (want to watch) ---");
    for (const r of reviewWant) console.log(`  "${r.title}" — ${r.reason}`);
  }

  if (!COMMIT) {
    console.log("\nDry run complete. Re-run with --commit to actually import the confident + tiebreak matches above.");
    return;
  }

  console.log("\nImporting confirmed + tiebreak matches...");
  let imported = 0;
  for (const item of [...toImportConfirmed, ...toImportTiebreak]) {
    const status = item.source === "watched" ? Status.WATCHED : Status.WANT;
    const created = await addTitle(item.candidate.tmdbId, item.candidate.mediaType, status);
    if (item.source === "watched" && item.watchedAt) {
      await prisma.title.update({ where: { id: created.id }, data: { watchedAt: item.watchedAt } });
    }
    imported++;
    await sleep(SEARCH_DELAY_MS);
  }
  console.log(`Imported ${imported} titles.`);
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
