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
// The "W"/value text uses the real in-game tile font (Figtree Bold, same
// as App.css's .tile-letter/.tile-value) rather than a hand-drawn shape.
// Google Fonts' @import in App.css only works in a browser page context, so
// for both this offline rasterization step and the standalone favicon.svg
// (loaded by browser chrome outside the page, same problem), the actual
// font file (src/assets/fonts/figtree-bold.ttf) is embedded as a base64
// @font-face data URI -- self-contained, renders identically everywhere,
// no dependency on Figtree being installed on whatever machine runs this.
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

async function embedFont(svgPath) {
  const svg = await readFile(svgPath, "utf8");
  const fontPath = path.join(assetsDir, "fonts", "figtree-bold.ttf");
  const fontBase64 = (await readFile(fontPath)).toString("base64");
  const style = `<defs><style>@font-face { font-family: 'Figtree'; font-weight: 700; src: url(data:font/ttf;base64,${fontBase64}) format('truetype'); }</style></defs>`;
  return svg.replace(/(<svg[^>]*>)/, `$1${style}`);
}

async function render(svg, size, outPath) {
  await sharp(Buffer.from(svg)).resize(size, size).png().toFile(outPath);
  console.log(`wrote ${path.relative(root, outPath)} (${size}x${size})`);
}

async function renderSet(svg, dir) {
  await mkdir(dir, { recursive: true });
  await render(svg, 192, path.join(dir, "icon-192.png"));
  await render(svg, 512, path.join(dir, "icon-512.png"));
  await render(svg, 192, path.join(dir, "maskable-192.png"));
  await render(svg, 512, path.join(dir, "maskable-512.png"));
}

async function main() {
  const icon = await embedFont(path.join(assetsDir, "icon.svg"));
  const iconPreview = await embedFont(path.join(assetsDir, "icon-preview.svg"));

  await renderSet(icon, iconsDir);
  // index.html's <link rel="apple-touch-icon"> is a single static tag (not
  // env-aware like manifest.webmanifest is), so only the production mark
  // ever needs an apple-touch-icon render — a preview one would go unused.
  await renderSet(iconPreview, path.join(iconsDir, "preview"));

  await render(icon, 180, path.join(root, "public", "apple-touch-icon.png"));
  await render(icon, 32, path.join(root, "public", "favicon-32.png"));
  await render(icon, 16, path.join(root, "public", "favicon-16.png"));
  await writeFile(path.join(root, "public", "favicon.svg"), icon);
  console.log("wrote public/favicon.svg");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
