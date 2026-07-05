// HTTP + WebSocket entry point. Serves the built client in production and
// hosts the multiplayer WebSocket endpoint at /ws.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, type WebSocket } from 'ws';
import type { ClientMessage } from '../../shared/types';
import { RoomManager } from './rooms';

const PORT = Number(process.env.PORT ?? 8787);
const CLIENT_DIR = fileURLToPath(new URL('../../client/dist', import.meta.url));

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

async function serveStatic(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let pathname = decodeURIComponent(url.pathname);
  if (pathname === '/') pathname = '/index.html';
  // Prevent path traversal.
  const safe = normalize(pathname).replace(/^(\.\.[/\\])+/, '');
  let filePath = join(CLIENT_DIR, safe);

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = join(filePath, 'index.html');
  } catch {
    // Fall back to SPA entry for unknown routes.
    filePath = join(CLIENT_DIR, 'index.html');
  }

  try {
    const data = await readFile(filePath);
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream',
      'Cache-Control': extname(filePath) === '.html' ? 'no-cache' : 'public, max-age=3600',
    });
    res.end(data);
  } catch {
    res.writeHead(404).end('Not found');
  }
}

const server = createServer((req, res) => {
  if (req.url === '/healthz') {
    res.writeHead(200, { 'Content-Type': 'text/plain' }).end('ok');
    return;
  }
  serveStatic(req, res).catch(() => res.writeHead(500).end('error'));
});

const wss = new WebSocketServer({ noServer: true });
const rooms = new RoomManager();

server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (url.pathname !== '/ws') {
    socket.destroy();
    return;
  }
  wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws));
});

wss.on('connection', (ws: WebSocket) => {
  ws.on('message', (raw) => {
    let msg: ClientMessage;
    try {
      msg = JSON.parse(raw.toString()) as ClientMessage;
    } catch {
      return;
    }
    rooms.handleMessage(ws, msg);
  });
  ws.on('close', () => rooms.leave(ws));
  ws.on('error', () => rooms.leave(ws));
});

server.listen(PORT, () => {
  console.log(`QIX server listening on http://localhost:${PORT} (ws: /ws)`);
});
