import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Node build of src/entry-server.tsx, used by scripts/prerender.ts to render
// the marketing pages to HTML. Kept apart from vite.config.ts because the
// Cloudflare plugin would take over the SSR build.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    ssr: "src/entry-server.tsx",
    outDir: "dist/prerender",
    emptyOutDir: true,
    copyPublicDir: false,
  },
});
