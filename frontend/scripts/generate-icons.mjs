// Rasterizes the hand-authored SVG marks (src/assets/icon-*.svg) into the
// PWA icon set under public/icons/, plus a top-level favicon. Re-run this
// whenever the source SVGs change — the PNGs are committed output, not
// generated at build time, so the manifest can reference plain static files.
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

async function main() {
  await mkdir(iconsDir, { recursive: true });

  const standard = path.join(assetsDir, "icon-standard.svg");
  const maskable = path.join(assetsDir, "icon-maskable.svg");

  await render(standard, 192, path.join(iconsDir, "icon-192.png"));
  await render(standard, 512, path.join(iconsDir, "icon-512.png"));
  await render(maskable, 192, path.join(iconsDir, "maskable-192.png"));
  await render(maskable, 512, path.join(iconsDir, "maskable-512.png"));
  // iOS ignores alpha and flattens transparency to black; icon-standard.svg
  // already has an opaque backdrop so this is safe as-is.
  await render(standard, 180, path.join(root, "public", "apple-touch-icon.png"));
  await render(standard, 32, path.join(root, "public", "favicon-32.png"));
  await render(standard, 16, path.join(root, "public", "favicon-16.png"));

  await writeFile(path.join(root, "public", "favicon.svg"), await readFile(standard));
  console.log("wrote public/favicon.svg");

  // Sage-green variant for PR preview stacks (see generate-manifest.mjs) so
  // an installed preview PWA is never confused with the real app.
  const previewDir = path.join(iconsDir, "preview");
  await mkdir(previewDir, { recursive: true });
  const standardPreview = path.join(assetsDir, "icon-standard-preview.svg");
  const maskablePreview = path.join(assetsDir, "icon-maskable-preview.svg");

  await render(standardPreview, 192, path.join(previewDir, "icon-192.png"));
  await render(standardPreview, 512, path.join(previewDir, "icon-512.png"));
  await render(maskablePreview, 192, path.join(previewDir, "maskable-192.png"));
  await render(maskablePreview, 512, path.join(previewDir, "maskable-512.png"));
  await render(standardPreview, 180, path.join(previewDir, "apple-touch-icon.png"));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
