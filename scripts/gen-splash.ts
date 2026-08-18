/**
 * One-off: renders the iOS launch images ("apple-touch-startup-image") from
 * public/popcorn.svg onto the app's black background.
 *
 * WHY THESE EXIST. On iOS, a standalone PWA's launch window (home-screen tap
 * until the page's first paint) is covered by an apple-touch-startup-image or by
 * nothing at all. No React component can cover it, because React is not running
 * yet. iOS also ignores any image whose media query does not match the device
 * EXACTLY, which is why this generates one file per device geometry rather than
 * one scalable asset.
 *
 * Portrait only, deliberately: the app is used upright, and covering both
 * orientations would double the asset count for a case that does not arise on a
 * phone held normally. A landscape launch falls back to the plain background.
 *
 * iPhone only. An iPad launch also falls back to the background.
 *
 * Not wired into the app. Run manually:
 *   npx tsx scripts/gen-splash.ts
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const MARK_SVG = path.join(ROOT, "public/popcorn.svg");
const OUT_DIR = path.join(ROOT, "public/splash");

// The app's dark background (globals.css --background in the dark scheme), so
// the launch image and the app itself are the same colour and the handover is
// invisible.
const BACKGROUND = { r: 10, g: 10, b: 10, alpha: 1 };

// Strava-like proportions: a small mark with a lot of space around it. 22% of the
// shorter edge reads as deliberate rather than as a stretched logo.
const MARK_FRACTION = 0.22;

/**
 * Current iPhone geometries as CSS pixels plus device pixel ratio. iOS matches
 * on device-width/device-height/-webkit-device-pixel-ratio, so each entry needs
 * its own file at width*dpr by height*dpr.
 */
const DEVICES = [
  { w: 320, h: 568, dpr: 2 }, // SE (1st gen)
  { w: 375, h: 667, dpr: 2 }, // SE (2nd/3rd), 8
  { w: 375, h: 812, dpr: 3 }, // X, XS, 11 Pro, 12/13 mini
  { w: 390, h: 844, dpr: 3 }, // 12, 13, 14
  { w: 393, h: 852, dpr: 3 }, // 14 Pro, 15, 15 Pro, 16
  { w: 402, h: 874, dpr: 3 }, // 16 Pro
  { w: 414, h: 736, dpr: 3 }, // 8 Plus
  { w: 414, h: 896, dpr: 2 }, // XR, 11
  { w: 414, h: 896, dpr: 3 }, // XS Max, 11 Pro Max
  { w: 428, h: 926, dpr: 3 }, // 12/13/14 Pro Max
  { w: 430, h: 932, dpr: 3 }, // 14 Pro Max, 15/15 Pro Max, 16 Plus
  { w: 440, h: 956, dpr: 3 }, // 16 Pro Max
];

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });
  // White mark: currentColor does not resolve in a rasterizer, so it is set here.
  const markSvg = readFileSync(MARK_SVG, "utf8").replace(/currentColor/g, "#ffffff");

  for (const { w, h, dpr } of DEVICES) {
    const px = { w: w * dpr, h: h * dpr };
    const markSize = Math.round(Math.min(px.w, px.h) * MARK_FRACTION);
    const mark = await sharp(Buffer.from(markSvg)).resize(markSize, markSize).png().toBuffer();

    const file = `apple-splash-${px.w}x${px.h}.png`;
    const png = await sharp({
      create: { width: px.w, height: px.h, channels: 4, background: BACKGROUND },
    })
      // Default gravity is centre, which is exactly the placement we want.
      .composite([{ input: mark, gravity: "centre" }])
      .png()
      .toBuffer();

    writeFileSync(path.join(OUT_DIR, file), png);
    console.log(`Wrote public/splash/${file}  (${w}x${h} @${dpr}x, mark ${markSize}px)`);
  }
  console.log(`\n${DEVICES.length} launch images written.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
