/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** WebSocket server URL for multiplayer when hosted separately (e.g. Pages + Render). */
  readonly VITE_WS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Injected at build time by Vite `define` (see vite.config.ts).
declare const __APP_VERSION__: string;
declare const __BUILD_ID__: string;
