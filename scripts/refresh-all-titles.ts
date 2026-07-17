/**
 * One-off backfill: refreshes every title in the library so recently-added
 * fields (backdrop, tagline, season/episode counts, watch providers) get
 * populated from TMDb/OMDb for titles that existed before those fields did.
 *
 * Reuses refreshTitle() as-is — no fetch/merge/persist logic duplicated here.
 * refreshTitle() only ever writes cached metadata (toData()'s fields); it
 * never includes status/note/myRating/addedAt/watchedAt in its update
 * payload, so user data is untouched by construction, not by convention.
 *
 * Not wired into the app. Run manually:
 *   npx tsx scripts/refresh-all-titles.ts
 */
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");

config({ path: path.join(ROOT, ".env.local") });

// Same pacing as scripts/import-google-takeout.ts, to stay under TMDb/OMDb rate limits.
const REFRESH_DELAY_MS = 300;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

interface Failure {
  title: string;
  id: string;
  error: string;
}

async function main() {
  // Dynamic import: prisma.ts reads process.env.DATABASE_URL at module scope,
  // so it must load after dotenv has populated process.env above — a static
  // import would be hoisted ahead of that config() call.
  const { prisma } = await import("../src/lib/prisma");
  const { refreshTitle } = await import("../src/lib/titles");

  const titles = await prisma.title.findMany({
    select: { id: true, title: true },
    orderBy: { addedAt: "asc" },
  });

  console.log(`Refreshing ${titles.length} titles...\n`);

  const failures: Failure[] = [];
  let refreshed = 0;

  for (let i = 0; i < titles.length; i++) {
    const { id, title } = titles[i];
    const position = `[${i + 1}/${titles.length}]`;
    try {
      await refreshTitle(id);
      refreshed++;
      console.log(`${position} Refreshed: ${title}`);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      failures.push({ title, id, error: message });
      console.log(`${position} FAILED: ${title} — ${message}`);
    }
    await sleep(REFRESH_DELAY_MS);
  }

  console.log("\n" + "=".repeat(60));
  console.log(`Done. Refreshed ${refreshed}/${titles.length}, ${failures.length} failed.`);
  if (failures.length > 0) {
    console.log("\nFailed titles:");
    for (const f of failures) console.log(`  "${f.title}" (${f.id}) — ${f.error}`);
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
