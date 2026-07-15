// Writes public/manifest.webmanifest, varying name/icon-set by VITE_APP_ENV
// so a PR preview stack's installed PWA is never confused with production
// (see the "Environment strategy" section of the push-notifications plan).
// Runs as a prebuild step (see package.json's "build" script); the checked-in
// manifest.webmanifest is just the "development" default `npm run dev` uses,
// since Vite's dev server serves public/ as static files with no build step.
//
// Usage: VITE_APP_ENV=production|preview|development node scripts/generate-manifest.mjs

import { writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, "..", "public");

const env = process.env.VITE_APP_ENV ?? "development";
const isPreview = env === "preview";
const isDev = env === "development";

const name = isPreview ? "Wordplay Preview" : isDev ? "Wordplay (Dev)" : "Wordplay";
const iconBase = isPreview ? "/icons/preview" : "/icons";

const manifest = {
  name,
  short_name: name,
  description: "A delightful word game for two.",
  start_url: "/",
  scope: "/",
  display: "standalone",
  background_color: "#fbf6ec",
  theme_color: isPreview ? "#3f6b4c" : "#e4602f",
  icons: [
    { src: `${iconBase}/icon-192.png`, sizes: "192x192", type: "image/png", purpose: "any" },
    { src: `${iconBase}/icon-512.png`, sizes: "512x512", type: "image/png", purpose: "any" },
    { src: `${iconBase}/maskable-192.png`, sizes: "192x192", type: "image/png", purpose: "maskable" },
    { src: `${iconBase}/maskable-512.png`, sizes: "512x512", type: "image/png", purpose: "maskable" },
  ],
};

await writeFile(path.join(publicDir, "manifest.webmanifest"), `${JSON.stringify(manifest, null, 2)}\n`);
console.log(`wrote public/manifest.webmanifest (env=${env})`);
