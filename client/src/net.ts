// Thin WebSocket client for multiplayer.
import type { ClientMessage, ServerMessage } from '@shared/types';

function wsUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss' : 'ws';
  return `${proto}://${location.host}/ws`;
}

export class NetClient {
  private ws: WebSocket | null = null;

  constructor(
    private onMessage: (msg: ServerMessage) => void,
    private onClose: () => void,
  ) {}

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(wsUrl());
      this.ws = ws;
      ws.addEventListener('open', () => resolve());
      ws.addEventListener('error', () => reject(new Error('接続に失敗しました')));
      ws.addEventListener('message', (ev) => {
        try {
          this.onMessage(JSON.parse(ev.data) as ServerMessage);
        } catch {
          /* ignore malformed frames */
        }
      });
      ws.addEventListener('close', () => this.onClose());
    });
  }

  send(msg: ClientMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  close(): void {
    this.ws?.close();
    this.ws = null;
  }
}
