/**
 * One-off: rasterizes the master icon (public/icon-master.svg) into the PNG
 * sizes the app actually references — the iOS home-screen icon and the PWA
 * manifest icons. Re-run whenever public/icon-master.svg changes.
 *
 * Not wired into the app. Run manually:
 *   npx tsx scripts/gen-icons.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const SOURCE_SVG = path.join(ROOT, "public/icon-master.svg");

// apple-touch-icon is iOS's own explicit home-screen icon lookup — it does
// not reliably fall back to the manifest's icons array the way Android/
// desktop PWA installs do.
const TARGETS = [
  { file: "apple-touch-icon.png", size: 180 },
  { file: "icons/icon-192.png", size: 192 },
  { file: "icons/icon-512.png", size: 512 },
];

async function main() {
  const svg = readFileSync(SOURCE_SVG);
  for (const { file, size } of TARGETS) {
    const out = path.join(ROOT, "public", file);
    const png = await sharp(svg).resize(size, size).png().toBuffer();
    writeFileSync(out, png);
    console.log(`Wrote public/${file} (${size}x${size})`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
