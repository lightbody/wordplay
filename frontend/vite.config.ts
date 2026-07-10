import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react()],
  build: {
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
        // TEMPORARY: diagnostic page for the iOS-Safari tile-seam bug, which
        // only reproduces on a real device -- shipping it in the build lets
        // it be opened from the PR preview on an iPhone (the dev-server-only
        // harness pages never deploy). Remove together with seam-lab.html /
        // src/seam-lab.tsx once that bug is closed.
        "seam-lab": path.resolve(__dirname, "seam-lab.html"),
      },
    },
  },
  resolve: {
    alias: {
      "@wordplay/shared": path.resolve(__dirname, "../shared/src/index.ts"),
    },
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ""),
      },
    },
  },
});
