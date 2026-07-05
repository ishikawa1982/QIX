// Shared types for the QIX-like territory game.
// Used by both the client (solo mode + rendering) and the server (authoritative sim).

/** Cell ownership stored in the `owner` grid. */
export const UNCLAIMED = 0;
/** 1..MAX_PLAYERS are player ids. */
export const BORDER = 255;

export const MAX_PLAYERS = 4;

/** Player colors, indexed by playerId - 1. */
export const PLAYER_COLORS = ['#22d3ee', '#f472b6', '#a3e635', '#fb923c'];

export type Dir = 'up' | 'down' | 'left' | 'right' | 'none';

export const DIR_VEC: Record<Dir, { x: number; y: number }> = {
  up: { x: 0, y: -1 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
  right: { x: 1, y: 0 },
  none: { x: 0, y: 0 },
};

export interface GameConfig {
  width: number;
  height: number;
  /** Win threshold as a fraction 0..1 of the claimable interior. */
  targetFraction: number;
  /** Round time limit in seconds; 0 = unlimited (solo). */
  timeLimit: number;
  /** Lives per player before elimination (solo: game over at 0). */
  startLives: number;
  /** Player move speed in cells/second. */
  playerSpeed: number;
  /** Enemy move speed in cells/second. */
  enemySpeed: number;
}

export const DEFAULT_CONFIG: GameConfig = {
  width: 96,
  height: 144,
  targetFraction: 0.75,
  timeLimit: 0,
  startLives: 3,
  playerSpeed: 18,
  enemySpeed: 20,
};

export interface PlayerState {
  id: number; // 1..MAX_PLAYERS
  name: string;
  color: string;
  x: number; // cell coords (integers)
  y: number;
  dir: Dir; // current desired direction
  drawing: boolean;
  trail: number[]; // cell indices of the current in-progress line
  lives: number;
  owned: number; // count of owned cells
  moveAcc: number; // sub-cell movement accumulator
  respawn: number; // seconds until movable again after a hit (0 = active)
  connected: boolean;
}

export interface Enemy {
  x: number;
  y: number;
  dx: number; // -1 | 1
  dy: number; // -1 | 1
  moveAcc: number;
}

export type GameStatus = 'playing' | 'won' | 'lost' | 'finished';

export interface GameState {
  config: GameConfig;
  owner: Uint8Array; // width*height
  trailOwner: Uint8Array; // width*height, 0 or playerId
  players: PlayerState[];
  enemies: Enemy[];
  rng: number; // mulberry32 state
  tick: number;
  elapsed: number; // seconds
  status: GameStatus;
  interiorTotal: number; // number of claimable (non-border) cells
}

// ---- Network protocol (client <-> server) ----

export interface PlayerMeta {
  id: number;
  name: string;
  color: string;
  owned: number;
  lives: number;
  connected: boolean;
}

export type ClientMessage =
  | { t: 'createRoom'; name: string }
  | { t: 'joinRoom'; code: string; name: string }
  | { t: 'setName'; name: string }
  | { t: 'startGame' }
  | { t: 'input'; dir: Dir }
  | { t: 'leaveRoom' };

export interface SnapshotPlayer {
  id: number;
  x: number;
  y: number;
  drawing: boolean;
  lives: number;
  owned: number;
  respawn: boolean;
}

export type ServerMessage =
  | { t: 'joined'; code: string; youId: number; players: PlayerMeta[]; hostId: number }
  | { t: 'roomState'; players: PlayerMeta[]; hostId: number }
  | { t: 'gameStart'; config: GameConfig; players: PlayerMeta[] }
  | { t: 'claim'; cells: number[] } // flattened [index, owner, index, owner, ...]
  | {
      t: 'snapshot';
      players: SnapshotPlayer[];
      enemies: { x: number; y: number }[];
      trails: { id: number; cells: number[] }[];
      elapsed: number;
      status: GameStatus;
    }
  | { t: 'gameOver'; ranking: { id: number; name: string; owned: number; percent: number }[] }
  | { t: 'error'; message: string };
