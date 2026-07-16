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

const COMMIT = process.argv.includes("--commit");
const SEARCH_DELAY_MS = 300;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// --- normalization + fuzzy matching -----------------------------------------

function normalize(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function levenshtein(a: string, b: string): number {
  const dp: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = 0; i <= a.length; i++) dp[i][0] = i;
  for (let j = 0; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[a.length][b.length];
}

function isCloseMatch(query: string, candidate: string): boolean {
  const a = normalize(query);
  const b = normalize(candidate);
  if (!a || !b) return false;
  if (a === b) return true;
  const dist = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);
  return dist <= Math.max(1, Math.floor(maxLen * 0.12));
}

// Tiebreak for the ambiguous bucket only: auto-pick a candidate over the rest
// of an equally-title-matching field, but only when it dominates by a real
// order of magnitude on a stable TMDb signal — not a marginal edge. Tried
// against vote_count first (a slow-moving, accumulated signal that's hard to
// game), falling back to popularity (catches brand-new releases that haven't
// accumulated votes yet but are clearly the one meant).
const DOMINANCE_RATIO = 10;
const MIN_VOTE_COUNT_FLOOR = 50;
const MIN_POPULARITY_FLOOR = 20;

function pickDominantCandidate(candidates: SearchResult[]): { winner: SearchResult; note: string } | null {
  for (const metric of ["voteCount", "popularity"] as const) {
    const floor = metric === "voteCount" ? MIN_VOTE_COUNT_FLOOR : MIN_POPULARITY_FLOOR;
    const sorted = [...candidates].sort((a, b) => b[metric] - a[metric]);
    const [top, runnerUp] = sorted;
    if (top[metric] >= floor && top[metric] >= (runnerUp?.[metric] ?? 0) * DOMINANCE_RATIO) {
      const label = metric === "voteCount" ? "vote count" : "popularity";
      return {
        winner: top,
        note: `${label} dominance: ${top[metric]} vs runner-up ${runnerUp?.[metric] ?? 0}`,
      };
    }
  }
  return null;
}

interface MatchOutcome {
  outcome: "confident" | "tiebreak" | "review";
  reason?: string;
  candidate?: SearchResult;
}

function evaluateMatch(query: string, results: SearchResult[]): MatchOutcome {
  if (results.length === 0) return { outcome: "review", reason: "no TMDb results" };
  const top = results[0];
  if (!isCloseMatch(query, top.title)) {
    return {
      outcome: "review",
      reason: `no close match — top result was "${top.title}" (${top.mediaType}${top.year ? " " + top.year : ""}, id ${top.tmdbId})`,
    };
  }
  const closeMatches = results.filter((r) => isCloseMatch(query, r.title));
  const distinctTargets = new Map<string, SearchResult>();
  for (const r of closeMatches) distinctTargets.set(`${r.mediaType}:${r.tmdbId}`, r);
  const candidates = [...distinctTargets.values()];
  if (candidates.length === 1) {
    return { outcome: "confident", candidate: top };
  }

  const dominant = pickDominantCandidate(candidates);
  if (dominant) {
    const listNote = candidates
      .map((r) => `"${r.title}" (${r.mediaType}${r.year ? " " + r.year : ""}, id ${r.tmdbId}, votes ${r.voteCount}, pop ${r.popularity.toFixed(1)})`)
      .join(", ");
    return {
      outcome: "tiebreak",
      candidate: dominant.winner,
      reason: `picked "${dominant.winner.title}" (${dominant.winner.mediaType}${dominant.winner.year ? " " + dominant.winner.year : ""}, id ${dominant.winner.tmdbId}) by ${dominant.note} — full field: ${listNote}`,
    };
  }

  const list = candidates
    .slice(0, 5)
    .map((r) => `"${r.title}" (${r.mediaType}${r.year ? " " + r.year : ""}, id ${r.tmdbId})`)
    .join(", ");
  return { outcome: "review", reason: `ambiguous — multiple close matches: ${list}` };
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
