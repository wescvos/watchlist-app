/**
 * Clears mood tags from every "Want to watch" title, so the next backfill
 * re-tags the whole list from scratch.
 *
 * WHY THIS EXISTS. Changing the mood vocabulary invalidates the stored tags,
 * and not only for the titles carrying a removed label. Every title is judged
 * against the WHOLE mood set, so titles tagged under an older set were never
 * offered the new options. Re-tagging only the rows that carried a retired
 * label would leave two populations in one library, judged against different
 * option sets, with no way to tell them apart. So a vocabulary change means a
 * full re-tag, and a full re-tag starts here.
 *
 * It clears BOTH `moods` and `moodsTaggedAt`. Clearing only the timestamp would
 * leave the picker counting labels from a retired vocabulary until the backfill
 * caught up. (The screens are safe either way, since the picker only counts
 * labels present in MOODS, so a retired label is invisible rather than broken.
 * But an honest intermediate state beats a merely safe one.)
 *
 * DESTRUCTIVE, and requires --confirm. It only touches the two mood columns:
 * status, ratings, notes, pinned state, and watch dates are never in the update
 * payload, so user data is untouched by construction rather than by convention.
 *
 * Run manually, then run the backfill:
 *   npx tsx scripts/clear-want-moods.ts             # refuses, shows what it would do
 *   npx tsx scripts/clear-want-moods.ts --confirm
 *   npx tsx scripts/tag-all-moods.ts --model gemini-3.5-flash
 */
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");

config({ path: path.join(ROOT, ".env.local") });

async function main() {
  const confirmed = process.argv.includes("--confirm");

  // Dynamic import: prisma.ts reads process.env.DATABASE_URL at module scope,
  // so it must load after dotenv has populated process.env above.
  const { prisma } = await import("../src/lib/prisma");
  const { MOOD_LABELS } = await import("../src/lib/moods");

  const total = await prisma.title.count({ where: { status: "WANT" } });
  const tagged = await prisma.title.count({
    where: { status: "WANT", moodsTaggedAt: { not: null } },
  });

  console.log(`Current mood vocabulary (${MOOD_LABELS.length}): ${MOOD_LABELS.join(", ")}`);
  console.log(`Want titles: ${total}, of which tagged: ${tagged}`);

  if (!confirmed) {
    console.log(`\nWould clear moods + moodsTaggedAt on all ${total} Want titles.`);
    console.log("Nothing changed. Re-run with --confirm to actually clear.");
    return;
  }

  const result = await prisma.title.updateMany({
    where: { status: "WANT" },
    // Only these two fields. Nothing else is in the payload.
    data: { moods: [], moodsTaggedAt: null },
  });

  const stillTagged = await prisma.title.count({
    where: { status: "WANT", moodsTaggedAt: { not: null } },
  });

  console.log(`\nCleared ${result.count} Want titles. Still tagged: ${stillTagged} (expected 0).`);
  console.log("Next: npx tsx scripts/tag-all-moods.ts --model gemini-3.5-flash");
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
