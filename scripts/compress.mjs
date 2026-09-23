/**
 * Compresses wand art and writes the manifest.
 *
 *   node scripts/compress.mjs flowers
 *   node scripts/compress.mjs            (does every wand)
 *
 * Put your full-size drawings in  art-source/<wand>/
 * This writes optimized WebP into  public/art/<wand>/  and regenerates
 * that wand's manifest.json.
 *
 * Why 256px: particles render at most ~92px on screen. At 2x device pixel
 * ratio that's ~184px, and the burst scales up ~1.5x. 256 covers it with
 * room to spare — 512 was shipping 4x the pixels for no visible gain.
 */

import sharp from "sharp";
import { readdir, mkdir, writeFile, stat } from "node:fs/promises";
import { join } from "node:path";

const SIZE = 256;
const QUALITY = 82;

const WANDS = ["flowers", "stars", "spells", "creatures"];
const only = process.argv[2];
const targets = only ? [only] : WANDS;

const kb = (n) => (n / 1024).toFixed(1) + "KB";

for (const wand of targets) {
  const src = join("art-source", wand);
  const dest = join("public", "art", wand);

  let files;
  try {
    files = (await readdir(src)).filter((f) => /\.(png|jpe?g|webp)$/i.test(f));
  } catch {
    console.log(`· ${wand}: no art-source/${wand} folder, skipping`);
    continue;
  }

  if (files.length === 0) {
    console.log(`· ${wand}: no images found`);
    continue;
  }

  await mkdir(dest, { recursive: true });

  let before = 0;
  let after = 0;
  const names = [];

  for (const file of files) {
    const outName = file.replace(/\.[^.]+$/, "") + ".webp";
    const inPath = join(src, file);
    const outPath = join(dest, outName);

    await sharp(inPath)
      .resize(SIZE, SIZE, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .webp({ quality: QUALITY, alphaQuality: 90, effort: 6 })
      .toFile(outPath);

    before += (await stat(inPath)).size;
    after += (await stat(outPath)).size;
    names.push(outName);
  }

  // Natural sort so f2 comes before f10 (cosmetic; selection is random anyway)
  names.sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  await writeFile(join(dest, "manifest.json"), JSON.stringify(names));

  const saved = ((1 - after / before) * 100).toFixed(0);
  console.log(
    `✓ ${wand}: ${names.length} images · ${kb(before)} → ${kb(after)} (${saved}% smaller)`
  );
}
