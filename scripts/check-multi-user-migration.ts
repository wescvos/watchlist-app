/**
 * Read-only post-deploy check for the multi-user migration. Confirms every
 * existing Title became a ListEntry for the owner, and that the owner's entries
 * carry exactly the personal fields the old Title columns held.
 *
 * Reads the legacy personal columns on Title ON PURPOSE: it is the one script
 * allowed to, because the comparison is its whole job. Writes nothing.
 *
 * Exits non-zero unless the counts match and zero titles differ.
 *
 *   npx tsx scripts/check-multi-user-migration.ts
 *   npx tsx scripts/check-multi-user-migration.ts --email other@example.com
 */
import { config } from "dotenv";
import { fileURLToPath } from "node:url";
import path from "node:path";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");

config({ path: path.join(ROOT, ".env.local") });

const OWNER_EMAIL = "wesley@vosk.co.za";

function sameTime(a: Date | null, b: Date | null) {
  return (a?.getTime() ?? null) === (b?.getTime() ?? null);
}

async function main() {
  const flag = process.argv.indexOf("--email");
  const email = (flag >= 0 ? process.argv[flag + 1] ?? "" : OWNER_EMAIL).trim().toLowerCase();

  // Dynamic import: prisma.ts reads process.env.DATABASE_URL at module scope,
  // so it must load after dotenv has populated process.env above.
  const { prisma } = await import("../src/lib/prisma");

  const owner = await prisma.user.findUnique({ where: { email }, select: { id: true } });
  if (!owner) {
    console.error(`No user with email ${email}. Sign in once before running this check.`);
    process.exit(1);
  }

  const titles = await prisma.title.findMany({
    select: {
      id: true,
      title: true,
      status: true,
      note: true,
      myRating: true,
      pinned: true,
      pinnedAt: true,
      addedAt: true,
      watchedAt: true,
      entries: {
        where: { userId: owner.id },
        select: {
          status: true,
          note: true,
          myRating: true,
          pinned: true,
          pinnedAt: true,
          addedAt: true,
          watchedAt: true,
        },
      },
    },
  });
  const entryCount = await prisma.listEntry.count({ where: { userId: owner.id } });

  const differing: string[] = [];
  for (const t of titles) {
    const e = t.entries[0];
    const same =
      e !== undefined &&
      e.status === t.status &&
      e.note === t.note &&
      e.myRating === t.myRating &&
      e.pinned === t.pinned &&
      sameTime(e.pinnedAt, t.pinnedAt) &&
      sameTime(e.addedAt, t.addedAt) &&
      sameTime(e.watchedAt, t.watchedAt);
    if (!same) differing.push(`${t.title} (${t.id})${e ? "" : " [no entry]"}`);
  }

  console.log(`Owner: ${email}`);
  console.log(`Titles: ${titles.length}`);
  console.log(`Owner ListEntry rows: ${entryCount}`);
  console.log(`Titles whose personal columns differ from the owner's entry: ${differing.length}`);
  for (const d of differing.slice(0, 20)) console.log(`  - ${d}`);
  if (differing.length > 20) console.log(`  ... and ${differing.length - 20} more`);

  if (titles.length !== entryCount || differing.length !== 0) {
    console.error("\nFAIL: the migration did not carry everything across.");
    process.exitCode = 1;
    return;
  }
  console.log("\nOK: counts match and no personal field differs.");
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
