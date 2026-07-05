import { defineConfig } from 'vite';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const sharedDir = fileURLToPath(new URL('../shared', import.meta.url));
const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// WebSocket backend for `npm run dev` (server listens on :8787).
const WS_TARGET = process.env.WS_TARGET ?? 'ws://localhost:8787';

// Base path. Root for local dev / single-service (Render) deploys; a repo
// subpath (e.g. "/qix/") for GitHub Pages project sites, set in CI.
const BASE = process.env.PAGES_BASE ?? '/';

// Short build identifier so each deploy is distinguishable (helps confirm a
// new version actually loaded past caches). Prefer the CI commit SHA.
function buildId(): string {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA.slice(0, 7);
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export default defineConfig({
  base: BASE,
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_ID__: JSON.stringify(buildId()),
  },
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
