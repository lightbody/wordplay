// Rasterizes the hand-authored SVG marks (src/assets/icon*.svg) into the
// PWA icon set under public/icons/, plus a top-level favicon. Re-run this
// whenever the source SVGs change — the PNGs are committed output, not
// generated at build time, so the manifest can reference plain static files.
//
// The design is full-bleed (no backdrop/rounding of our own — iOS/Android
// apply their own icon mask), so the same source image serves both the
// "any" and "maskable" manifest purposes; there's no separate maskable
// source to keep in sync.
//
// Usage: node scripts/generate-icons.mjs

import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(__dirname, "..");
const assetsDir = path.join(root, "src", "assets");
const iconsDir = path.join(root, "public", "icons");

async function render(svgPath, size, outPath) {
  const svg = await readFile(svgPath);
  await sharp(svg).resize(size, size).png().toFile(outPath);
  console.log(`wrote ${path.relative(root, outPath)} (${size}x${size})`);
}

async function renderSet(source, dir) {
  await mkdir(dir, { recursive: true });
  await render(source, 192, path.join(dir, "icon-192.png"));
  await render(source, 512, path.join(dir, "icon-512.png"));
  await render(source, 192, path.join(dir, "maskable-192.png"));
  await render(source, 512, path.join(dir, "maskable-512.png"));
}

async function main() {
  const icon = path.join(assetsDir, "icon.svg");
  const iconPreview = path.join(assetsDir, "icon-preview.svg");

  await renderSet(icon, iconsDir);
  // index.html's <link rel="apple-touch-icon"> is a single static tag (not
  // env-aware like manifest.webmanifest is), so only the production mark
  // ever needs an apple-touch-icon render — a preview one would go unused.
  await renderSet(iconPreview, path.join(iconsDir, "preview"));

  await render(icon, 180, path.join(root, "public", "apple-touch-icon.png"));
  await render(icon, 32, path.join(root, "public", "favicon-32.png"));
  await render(icon, 16, path.join(root, "public", "favicon-16.png"));
  await writeFile(path.join(root, "public", "favicon.svg"), await readFile(icon));
  console.log("wrote public/favicon.svg");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
