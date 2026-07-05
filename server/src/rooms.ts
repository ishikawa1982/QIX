// Room + authoritative game-loop management for multiplayer.
import type { WebSocket } from 'ws';
import {
  DEFAULT_CONFIG,
  MAX_PLAYERS,
  PLAYER_COLORS,
  type ClientMessage,
  type Dir,
  type GameConfig,
  type PlayerMeta,
  type ServerMessage,
  type GameState,
} from '../../shared/types';
import { createGame, setPlayerDir, step } from '../../shared/simulation';

const TICK_HZ = 30;
const DT = 1 / TICK_HZ;

const MP_CONFIG: GameConfig = {
  ...DEFAULT_CONFIG,
  timeLimit: 120,
  startLives: 3,
  targetFraction: 0.75,
};

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

interface Member {
  ws: WebSocket;
  id: number; // player id 1..MAX_PLAYERS
  name: string;
  connected: boolean;
}

export class Room {
  readonly code: string;
  private members = new Map<number, Member>();
  private hostId = 0;
  private nextId = 1;
  private state: GameState | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private prevOwner: Uint8Array | null = null;

  constructor(code: string, private onEmpty: (code: string) => void) {
    this.code = code;
  }

  get size(): number {
    return this.members.size;
  }

  get started(): boolean {
    return this.state !== null;
  }

  private metas(): PlayerMeta[] {
    return [...this.members.values()].map((m) => ({
      id: m.id,
      name: m.name,
      color: PLAYER_COLORS[(m.id - 1) % PLAYER_COLORS.length],
      owned: this.state?.players[m.id - 1]?.owned ?? 0,
      lives: this.state?.players[m.id - 1]?.lives ?? MP_CONFIG.startLives,
      connected: m.connected,
    }));
  }

  private broadcast(msg: ServerMessage): void {
    for (const m of this.members.values()) send(m.ws, msg);
  }

  add(ws: WebSocket, name: string): number | null {
    if (this.started || this.members.size >= MAX_PLAYERS) return null;
    const id = this.nextId++;
    this.members.set(id, { ws, id, name: name.slice(0, 10), connected: true });
    if (this.hostId === 0) this.hostId = id;
    send(ws, { t: 'joined', code: this.code, youId: id, players: this.metas(), hostId: this.hostId });
    this.broadcast({ t: 'roomState', players: this.metas(), hostId: this.hostId });
    return id;
  }

  remove(id: number): void {
    const m = this.members.get(id);
    if (!m) return;
    if (this.state) {
      // Mid-game: mark disconnected but keep the slot so ids stay stable.
      m.connected = false;
      const p = this.state.players[id - 1];
      if (p) {
        p.connected = false;
        p.dir = 'none';
      }
      if ([...this.members.values()].every((mm) => !mm.connected)) this.stop();
    } else {
      this.members.delete(id);
      if (id === this.hostId) {
        this.hostId = this.members.size ? [...this.members.keys()][0] : 0;
      }
      this.broadcast({ t: 'roomState', players: this.metas(), hostId: this.hostId });
    }
    if (this.members.size === 0) {
      this.stop();
      this.onEmpty(this.code);
    }
  }

  handle(id: number, msg: ClientMessage): void {
    const m = this.members.get(id);
    if (!m) return;
    switch (msg.t) {
      case 'setName':
        m.name = msg.name.slice(0, 10);
        this.broadcast({ t: 'roomState', players: this.metas(), hostId: this.hostId });
        break;
      case 'startGame':
        if (id === this.hostId && !this.started && this.members.size >= 1) this.start();
        break;
      case 'input':
        if (this.state) setPlayerDir(this.state, id, msg.dir as Dir);
        break;
      default:
        break;
    }
  }

  private start(): void {
    const metaList = [...this.members.values()];
    this.state = createGame({
      config: MP_CONFIG,
      playerCount: metaList.length,
      playerMetas: metaList.map((m) => ({
        name: m.name,
        color: PLAYER_COLORS[(m.id - 1) % PLAYER_COLORS.length],
      })),
      enemyCount: 1,
      seed: (Math.random() * 2 ** 31) | 0,
    });
    this.prevOwner = this.state.owner.slice();
    this.broadcast({ t: 'gameStart', config: MP_CONFIG, players: this.metas() });
    this.timer = setInterval(() => this.tick(), 1000 / TICK_HZ);
  }

  private tick(): void {
    const state = this.state;
    if (!state) return;
    step(state, DT);

    // Diff the owner grid; only send cells that changed (claims).
    const prev = this.prevOwner!;
    const cells: number[] = [];
    const owner = state.owner;
    for (let i = 0; i < owner.length; i++) {
      if (owner[i] !== prev[i]) {
        cells.push(i, owner[i]);
        prev[i] = owner[i];
      }
    }
    if (cells.length) this.broadcast({ t: 'claim', cells });

    this.broadcast({
      t: 'snapshot',
      players: state.players.map((p) => ({
        id: p.id,
        x: p.x,
        y: p.y,
        drawing: p.drawing,
        lives: p.lives,
        owned: p.owned,
        respawn: p.respawn > 0,
      })),
      enemies: state.enemies.map((e) => ({ x: e.x, y: e.y })),
      trails: state.players
        .filter((p) => p.trail.length > 0)
        .map((p) => ({ id: p.id, cells: p.trail.slice() })),
      elapsed: state.elapsed,
      status: state.status,
    });

    if (state.status !== 'playing') this.finish();
  }

  private finish(): void {
    const state = this.state!;
    const ranking = state.players
      .map((p) => ({
        id: p.id,
        name: p.name,
        owned: p.owned,
        percent: (p.owned / state.interiorTotal) * 100,
      }))
      .sort((a, b) => b.percent - a.percent);
    this.broadcast({ t: 'gameOver', ranking });
    this.stop();
    this.state = null;
    this.prevOwner = null;
    // Rewind to lobby so a rematch is possible.
    this.hostId = this.members.size ? [...this.members.keys()][0] : 0;
    for (const m of this.members.values()) m.connected = m.ws.readyState === m.ws.OPEN;
    this.broadcast({ t: 'roomState', players: this.metas(), hostId: this.hostId });
  }

  private stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  private conns = new Map<WebSocket, { code: string; id: number }>();

  private makeCode(): string {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    do {
      code = '';
      for (let i = 0; i < 4; i++) code += alphabet[(Math.random() * alphabet.length) | 0];
    } while (this.rooms.has(code));
    return code;
  }

  handleMessage(ws: WebSocket, msg: ClientMessage): void {
    switch (msg.t) {
      case 'createRoom': {
        this.leave(ws);
        const room = new Room(this.makeCode(), (c) => this.rooms.delete(c));
        this.rooms.set(room.code, room);
        const id = room.add(ws, msg.name);
        if (id) this.conns.set(ws, { code: room.code, id });
        break;
      }
      case 'joinRoom': {
        const room = this.rooms.get(msg.code.toUpperCase());
        if (!room) return send(ws, { t: 'error', message: 'ルームが見つかりません' });
        if (room.started) return send(ws, { t: 'error', message: 'ゲームは既に開始しています' });
        this.leave(ws);
        const id = room.add(ws, msg.name);
        if (id) this.conns.set(ws, { code: room.code, id });
        else send(ws, { t: 'error', message: 'ルームが満員です' });
        break;
      }
      case 'leaveRoom':
        this.leave(ws);
        break;
      default: {
        const c = this.conns.get(ws);
        const room = c && this.rooms.get(c.code);
        if (c && room) room.handle(c.id, msg);
        break;
      }
    }
  }

  leave(ws: WebSocket): void {
    const c = this.conns.get(ws);
    if (!c) return;
    this.conns.delete(ws);
    this.rooms.get(c.code)?.remove(c.id);
  }
}
