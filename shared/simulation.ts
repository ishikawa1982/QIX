// Deterministic grid-based QIX simulation.
// The same code runs client-side (solo) and server-side (authoritative multiplayer).
import {
  BORDER,
  DIR_VEC,
  UNCLAIMED,
  type Enemy,
  type GameConfig,
  type GameState,
  type PlayerState,
} from './types';
import { createOwnerGrid, idx, inBounds, interiorCellCount, isSolid, nextRandom } from './grid';

export interface NewGameOptions {
  config: GameConfig;
  playerCount: number;
  playerMetas?: { name: string; color: string }[];
  enemyCount?: number;
  seed?: number;
}

const START_CORNERS = [
  { x: 0, y: 0 },
  { x: -1, y: -1 },
  { x: -1, y: 0 },
  { x: 0, y: -1 },
];

function startPos(config: GameConfig, playerIndex: number): { x: number; y: number } {
  const c = START_CORNERS[playerIndex % START_CORNERS.length];
  return {
    x: c.x < 0 ? config.width - 1 : c.x,
    y: c.y < 0 ? config.height - 1 : c.y,
  };
}

export function createGame(opts: NewGameOptions): GameState {
  const { config } = opts;
  const owner = createOwnerGrid(config);
  const trailOwner = new Uint8Array(config.width * config.height);
  const players: PlayerState[] = [];
  for (let i = 0; i < opts.playerCount; i++) {
    const meta = opts.playerMetas?.[i];
    const p = startPos(config, i);
    players.push({
      id: i + 1,
      name: meta?.name ?? `P${i + 1}`,
      color: meta?.color ?? '#ffffff',
      x: p.x,
      y: p.y,
      dir: 'none',
      drawing: false,
      trail: [],
      lives: config.startLives,
      owned: 0,
      moveAcc: 0,
      respawn: 0,
      connected: true,
    });
  }

  const enemyCount = opts.enemyCount ?? 1;
  let rng = opts.seed ?? 0x9e3779b9;
  const enemies: Enemy[] = [];
  for (let i = 0; i < enemyCount; i++) {
    let rx = nextRandom(rng);
    rng = rx.state;
    let ry = nextRandom(rng);
    rng = ry.state;
    enemies.push({
      x: Math.floor(config.width * 0.25 + rx.value * config.width * 0.5),
      y: Math.floor(config.height * 0.25 + ry.value * config.height * 0.5),
      dx: rx.value < 0.5 ? -1 : 1,
      dy: ry.value < 0.5 ? -1 : 1,
      moveAcc: 0,
    });
  }

  return {
    config,
    owner,
    trailOwner,
    players,
    enemies,
    rng,
    tick: 0,
    elapsed: 0,
    status: 'playing',
    interiorTotal: interiorCellCount(config),
  };
}

/** Set a player's desired direction. */
export function setPlayerDir(state: GameState, playerId: number, dir: PlayerState['dir']): void {
  const p = state.players.find((pl) => pl.id === playerId);
  if (p) p.dir = dir;
}

function resetPlayerToBorder(state: GameState, p: PlayerState): void {
  // Move the player to the nearest border cell so they are on a safe edge.
  const { config } = state;
  const nx = Math.min(config.width - 1, Math.max(0, p.x));
  const ny = Math.min(config.height - 1, Math.max(0, p.y));
  // Snap to whichever border edge is closest.
  const distances = [ny, config.height - 1 - ny, nx, config.width - 1 - nx];
  const min = Math.min(...distances);
  if (min === distances[0]) p.y = 0;
  else if (min === distances[1]) p.y = config.height - 1;
  else if (min === distances[2]) p.x = 0;
  else p.x = config.width - 1;
  p.dir = 'none';
}

function killPlayer(state: GameState, p: PlayerState): void {
  // Erase the in-progress line and knock the player back to a safe edge.
  for (const c of p.trail) state.trailOwner[c] = 0;
  p.trail = [];
  p.drawing = false;
  p.moveAcc = 0;
  p.lives -= 1;
  resetPlayerToBorder(state, p);
  p.respawn = 1.0; // brief invulnerable pause
}

/**
 * Claim territory after a player closes a loop.
 * Trail cells become owned, then every unclaimed cell that the enemies cannot
 * reach (sealed off) is filled for the closing player.
 */
function claimTerritory(state: GameState, p: PlayerState): number[] {
  const { config, owner } = state;
  const changed: number[] = [];

  for (const c of p.trail) {
    if (owner[c] === UNCLAIMED) {
      owner[c] = p.id;
      state.trailOwner[c] = 0;
      changed.push(c, p.id);
    }
  }
  p.trail = [];
  p.drawing = false;

  // Flood from every enemy over unclaimed space to find still-open cells.
  const total = config.width * config.height;
  const reachable = new Uint8Array(total);
  const stack: number[] = [];
  for (const e of state.enemies) {
    const ei = idx(config, e.x, e.y);
    if (owner[ei] === UNCLAIMED && !reachable[ei]) {
      reachable[ei] = 1;
      stack.push(ei);
    }
  }
  while (stack.length) {
    const cur = stack.pop()!;
    const cx = cur % config.width;
    const cy = (cur - cx) / config.width;
    const neighbors = [
      [cx + 1, cy],
      [cx - 1, cy],
      [cx, cy + 1],
      [cx, cy - 1],
    ];
    for (const [nx, ny] of neighbors) {
      if (!inBounds(config, nx, ny)) continue;
      const ni = idx(config, nx, ny);
      if (owner[ni] === UNCLAIMED && !reachable[ni]) {
        reachable[ni] = 1;
        stack.push(ni);
      }
    }
  }

  // Any unclaimed cell not reachable by an enemy is sealed -> claim it.
  for (let i = 0; i < total; i++) {
    if (owner[i] === UNCLAIMED && !reachable[i]) {
      owner[i] = p.id;
      changed.push(i, p.id);
    }
  }

  recountOwned(state);
  return changed;
}

function recountOwned(state: GameState): void {
  for (const p of state.players) p.owned = 0;
  const owner = state.owner;
  for (let i = 0; i < owner.length; i++) {
    const o = owner[i];
    if (o !== UNCLAIMED && o !== BORDER) {
      const p = state.players[o - 1];
      if (p) p.owned++;
    }
  }
}

/** Attempt to move a single player by one cell in its current direction. */
function stepPlayerOnce(state: GameState, p: PlayerState, changed: number[]): void {
  const { config, owner } = state;
  const v = DIR_VEC[p.dir];
  if (v.x === 0 && v.y === 0) return;
  const nx = p.x + v.x;
  const ny = p.y + v.y;
  if (!inBounds(config, nx, ny)) return;
  const ni = idx(config, nx, ny);

  if (!p.drawing) {
    if (isSolid(owner, ni)) {
      // Walk along a claimed edge / border.
      p.x = nx;
      p.y = ny;
    } else {
      // Step into open space -> start drawing.
      p.drawing = true;
      p.x = nx;
      p.y = ny;
      state.trailOwner[ni] = p.id;
      p.trail.push(ni);
    }
    return;
  }

  // Currently drawing.
  if (state.trailOwner[ni] === p.id) {
    // Would cross own line -> blocked.
    return;
  }
  if (isSolid(owner, ni)) {
    // Reconnected to claimed territory -> close the loop and claim.
    p.x = nx;
    p.y = ny;
    const claimed = claimTerritory(state, p);
    for (const c of claimed) changed.push(c);
    return;
  }
  // Extend the line into open space.
  p.x = nx;
  p.y = ny;
  state.trailOwner[ni] = p.id;
  p.trail.push(ni);
}

/** Move a single enemy by one cell, bouncing off solid cells. */
function stepEnemyOnce(state: GameState, e: Enemy): void {
  const { config, owner } = state;
  const tryMove = (dx: number, dy: number): boolean => {
    const nx = e.x + dx;
    const ny = e.y + dy;
    if (!inBounds(config, nx, ny)) return false;
    return !isSolid(owner, idx(config, nx, ny));
  };

  // Reflect blocked axes.
  if (!tryMove(e.dx, 0)) e.dx = -e.dx;
  if (!tryMove(0, e.dy)) e.dy = -e.dy;

  if (tryMove(e.dx, e.dy)) {
    e.x += e.dx;
    e.y += e.dy;
  } else if (tryMove(e.dx, 0)) {
    e.x += e.dx;
    e.dy = -e.dy;
  } else if (tryMove(0, e.dy)) {
    e.y += e.dy;
    e.dx = -e.dx;
  } else {
    // Fully boxed in; flip and jitter direction.
    e.dx = -e.dx;
    e.dy = -e.dy;
    const r = nextRandom(state.rng);
    state.rng = r.state;
    if (r.value < 0.5) e.dx = -e.dx;
  }
}

/** Check enemy-vs-trail collisions and apply hits. */
function resolveCollisions(state: GameState): void {
  for (const e of state.enemies) {
    const ei = idx(state.config, e.x, e.y);
    const hitId = state.trailOwner[ei];
    if (hitId !== 0) {
      const p = state.players[hitId - 1];
      if (p && p.respawn <= 0) killPlayer(state, p);
    }
  }
}

function updateStatus(state: GameState): void {
  const { config } = state;
  if (config.timeLimit > 0) {
    if (state.elapsed >= config.timeLimit) {
      state.status = 'finished';
      return;
    }
  }
  for (const p of state.players) {
    if (p.owned / state.interiorTotal >= config.targetFraction) {
      state.status = config.timeLimit > 0 ? 'finished' : 'won';
      return;
    }
  }
  if (config.timeLimit <= 0) {
    // Solo: out of lives -> lost.
    const anyAlive = state.players.some((p) => p.lives > 0);
    if (!anyAlive) state.status = 'lost';
  }
}

/**
 * Advance the simulation by dt seconds (use a fixed dt for determinism).
 * Returns the list of owner-grid changes as a flat [index, owner, ...] array,
 * for network diffing.
 */
export function step(state: GameState, dt: number): number[] {
  const changed: number[] = [];
  if (state.status !== 'playing') return changed;

  state.tick++;
  state.elapsed += dt;

  for (const p of state.players) {
    if (p.respawn > 0) {
      p.respawn = Math.max(0, p.respawn - dt);
      continue;
    }
    if (p.lives <= 0) continue;
    p.moveAcc += state.config.playerSpeed * dt;
    let steps = 0;
    while (p.moveAcc >= 1 && steps < 4) {
      p.moveAcc -= 1;
      steps++;
      stepPlayerOnce(state, p, changed);
    }
  }

  for (const e of state.enemies) {
    e.moveAcc += state.config.enemySpeed * dt;
    let steps = 0;
    while (e.moveAcc >= 1 && steps < 4) {
      e.moveAcc -= 1;
      steps++;
      stepEnemyOnce(state, e);
      resolveCollisions(state);
    }
  }

  // Also catch the case where a player drew into a stationary enemy's cell.
  resolveCollisions(state);
  updateStatus(state);
  return changed;
}

/** Percentage (0..100) of the claimable interior owned by a player. */
export function ownedPercent(state: GameState, playerId: number): number {
  const p = state.players[playerId - 1];
  if (!p) return 0;
  return (p.owned / state.interiorTotal) * 100;
}
