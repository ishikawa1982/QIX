import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';

const sharedDir = fileURLToPath(new URL('../shared', import.meta.url));

// WebSocket backend for `npm run dev` (server listens on :8787).
const WS_TARGET = process.env.WS_TARGET ?? 'ws://localhost:8787';

// Base path. Root for local dev / single-service (Render) deploys; a repo
// subpath (e.g. "/qix/") for GitHub Pages project sites, set in CI.
const BASE = process.env.PAGES_BASE ?? '/';

export default defineConfig({
  base: BASE,
  resolve: {
    alias: {
      '@shared': sharedDir,
    },
  },
  server: {
    host: true,
    port: 5173,
    fs: {
      // Allow importing the shared/ engine that lives outside the client root.
      allow: ['..'],
    },
    proxy: {
      '/ws': {
        target: WS_TARGET,
        ws: true,
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
  },
});
