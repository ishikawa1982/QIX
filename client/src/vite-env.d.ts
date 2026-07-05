/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** WebSocket server URL for multiplayer when hosted separately (e.g. Pages + Render). */
  readonly VITE_WS_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
