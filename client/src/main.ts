import './style.css';
import {
  DEFAULT_CONFIG,
  type Dir,
  type GameConfig,
  type GameStatus,
  type PlayerMeta,
  type ServerMessage,
  type SnapshotPlayer,
} from '@shared/types';
import { createGame, ownedPercent, step, type NewGameOptions } from '@shared/simulation';
import { createOwnerGrid, interiorCellCount } from '@shared/grid';
import { Renderer, type RenderView } from './render';
import { Controls } from './input';
import { NetClient } from './net';
import { colorFor, UI, type GameHandles } from './screens';

const DT = 1 / 60;

class App {
  private ui = new UI();
  private name = localStorage.getItem('qix.name') ?? '';
  private rafId = 0;
  private net: NetClient | null = null;
  private youId = 0;

  start(): void {
    this.ui.showTitle(() => this.menu());
  }

  private stopLoop(): void {
    if (this.rafId) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  private teardownNet(): void {
    this.net?.close();
    this.net = null;
  }

  private menu(): void {
    this.stopLoop();
    this.teardownNet();
    this.ui.showMenu(
      this.name,
      (n) => {
        this.name = n;
        localStorage.setItem('qix.name', n);
      },
      () => this.startSolo(),
      () => this.onlineEntry(),
    );
  }

  // ---------------- Solo ----------------

  private startSolo(): void {
    const config: GameConfig = { ...DEFAULT_CONFIG, timeLimit: 0, startLives: 3 };
    const opts: NewGameOptions = {
      config,
      playerCount: 1,
      playerMetas: [{ name: this.name || 'あなた', color: colorFor(1) }],
      enemyCount: 1,
      seed: (Math.random() * 2 ** 31) | 0,
    };
    let state = createGame(opts);
    const handles = this.ui.showGame();
    const renderer = new Renderer(handles.canvas, config);
    const onResize = () => renderer.resize();
    window.addEventListener('resize', onResize);
    new Controls(handles.controls, (dir: Dir) => {
      state.players[0].dir = dir;
    });

    let last = performance.now();
    let acc = 0;
    const frame = (now: number) => {
      acc += Math.min(0.1, (now - last) / 1000);
      last = now;
      while (acc >= DT) {
        step(state, DT);
        acc -= DT;
      }
      renderer.draw(this.soloView(state));
      const p = state.players[0];
      handles.setHud({
        target: config.targetFraction * 100,
        players: [
          {
            id: 1,
            name: p.name,
            color: p.color,
            percent: ownedPercent(state, 1),
            lives: p.lives,
            you: true,
          },
        ],
        message: '',
      });
      if (state.status !== 'playing') {
        window.removeEventListener('resize', onResize);
        this.stopLoop();
        this.soloResult(state.status, ownedPercent(state, 1), () => this.startSolo());
        return;
      }
      this.rafId = requestAnimationFrame(frame);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  private soloView(state: ReturnType<typeof createGame>): RenderView {
    return {
      config: state.config,
      owner: state.owner,
      trailOwner: state.trailOwner,
      players: state.players.map((p) => ({
        id: p.id,
        x: p.x,
        y: p.y,
        color: p.color,
        drawing: p.drawing,
        respawn: p.respawn > 0,
      })),
      enemies: state.enemies.map((e) => ({ x: e.x, y: e.y })),
      youId: 1,
    };
  }

  private soloResult(status: GameStatus, percent: number, onReplay: () => void): void {
    const title = status === 'won' ? 'クリア!' : 'ゲームオーバー';
    this.ui.showResult(
      title,
      [{ name: this.name || 'あなた', percent, color: colorFor(1), you: true }],
      onReplay,
      () => this.menu(),
    );
  }

  // ---------------- Online ----------------

  private onlineEntry(): void {
    this.ui.showOnlineEntry(
      () => this.connectThen((net) => net.send({ t: 'createRoom', name: this.name || 'あなた' })),
      (code) => this.connectThen((net) => net.send({ t: 'joinRoom', code, name: this.name || 'あなた' })),
      () => this.menu(),
    );
  }

  private connectThen(action: (net: NetClient) => void): void {
    this.ui.showConnecting();
    const net = new NetClient(
      (msg) => this.onServer(msg),
      () => {
        if (this.net) {
          this.ui.toast('接続が切れました');
          this.menu();
        }
      },
    );
    this.net = net;
    net
      .connect()
      .then(() => action(net))
      .catch(() => {
        this.ui.toast('サーバーに接続できません');
        this.menu();
      });
  }

  private lobbyUpdate: ((players: PlayerMeta[], canStart: boolean) => void) | null = null;
  private mp: {
    config: GameConfig;
    owner: Uint8Array;
    trailBuf: Uint8Array;
    metas: Map<number, PlayerMeta>;
    interior: number;
    snapshot: {
      players: SnapshotPlayer[];
      enemies: { x: number; y: number }[];
      trails: { id: number; cells: number[] }[];
      elapsed: number;
    } | null;
    handles: GameHandles;
    renderer: Renderer;
    onResize: () => void;
  } | null = null;

  private onServer(msg: ServerMessage): void {
    switch (msg.t) {
      case 'joined': {
        this.youId = msg.youId;
        const isHost = msg.hostId === msg.youId;
        this.lobbyUpdate = this.ui.showLobby(
          msg.code,
          isHost,
          () => this.net?.send({ t: 'startGame' }),
          () => this.menu(),
        );
        this.lobbyUpdate(msg.players, msg.players.length >= 2);
        break;
      }
      case 'roomState': {
        const isHost = msg.hostId === this.youId;
        this.lobbyUpdate?.(msg.players, isHost && msg.players.length >= 2);
        break;
      }
      case 'gameStart':
        this.startMultiplayer(msg.config, msg.players);
        break;
      case 'claim':
        if (this.mp) {
          for (let i = 0; i < msg.cells.length; i += 2) {
            this.mp.owner[msg.cells[i]] = msg.cells[i + 1];
          }
        }
        break;
      case 'snapshot':
        if (this.mp) {
          this.mp.snapshot = {
            players: msg.players,
            enemies: msg.enemies,
            trails: msg.trails,
            elapsed: msg.elapsed,
          };
        }
        break;
      case 'gameOver':
        this.mpResult(msg.ranking);
        break;
      case 'error':
        this.ui.toast(msg.message);
        if (!this.mp) this.menu();
        break;
    }
  }

  private startMultiplayer(config: GameConfig, players: PlayerMeta[]): void {
    this.stopLoop();
    const handles = this.ui.showGame();
    const renderer = new Renderer(handles.canvas, config);
    const onResize = () => renderer.resize();
    window.addEventListener('resize', onResize);
    const metas = new Map<number, PlayerMeta>();
    for (const p of players) metas.set(p.id, p);
    this.mp = {
      config,
      owner: createOwnerGrid(config),
      trailBuf: new Uint8Array(config.width * config.height),
      metas,
      interior: interiorCellCount(config),
      snapshot: null,
      handles,
      renderer,
      onResize,
    };
    new Controls(handles.controls, (dir: Dir) => this.net?.send({ t: 'input', dir }));

    const frame = () => {
      this.renderMultiplayer();
      this.rafId = requestAnimationFrame(frame);
    };
    this.rafId = requestAnimationFrame(frame);
  }

  private renderMultiplayer(): void {
    const mp = this.mp;
    if (!mp) return;
    const snap = mp.snapshot;
    mp.trailBuf.fill(0);
    if (snap) {
      for (const tr of snap.trails) {
        for (const c of tr.cells) mp.trailBuf[c] = tr.id;
      }
    }
    const view: RenderView = {
      config: mp.config,
      owner: mp.owner,
      trailOwner: mp.trailBuf,
      players: (snap?.players ?? []).map((p) => ({
        id: p.id,
        x: p.x,
        y: p.y,
        color: mp.metas.get(p.id)?.color ?? '#fff',
        drawing: p.drawing,
        respawn: p.respawn,
      })),
      enemies: snap?.enemies ?? [],
      youId: this.youId,
    };
    mp.renderer.draw(view);

    const timeLeft = mp.config.timeLimit > 0 ? mp.config.timeLimit - (snap?.elapsed ?? 0) : undefined;
    mp.handles.setHud({
      target: mp.config.targetFraction * 100,
      timeLeft,
      players: (snap?.players ?? [])
        .map((p) => ({
          id: p.id,
          name: mp.metas.get(p.id)?.name ?? `P${p.id}`,
          color: mp.metas.get(p.id)?.color ?? '#fff',
          percent: (p.owned / mp.interior) * 100,
          lives: p.lives,
          you: p.id === this.youId,
        }))
        .sort((a, b) => b.percent - a.percent),
    });
  }

  private mpResult(ranking: { id: number; name: string; owned: number; percent: number }[]): void {
    this.stopLoop();
    if (this.mp) window.removeEventListener('resize', this.mp.onResize);
    const rows = ranking.map((r) => ({
      name: r.name,
      percent: r.percent,
      color: colorFor(r.id),
      you: r.id === this.youId,
    }));
    const winner = ranking[0];
    const title = winner && winner.id === this.youId ? '勝利!' : '結果';
    this.mp = null;
    this.ui.showResult(
      title,
      rows,
      () => this.menu(),
      () => this.menu(),
    );
  }
}

new App().start();

// Register the service worker for offline solo play (production only).
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}
