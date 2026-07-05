// Grid helpers: creation, indexing, border init, and a seeded RNG.
import { BORDER, UNCLAIMED, type GameConfig } from './types';

export function idx(config: GameConfig, x: number, y: number): number {
  return y * config.width + x;
}

export function inBounds(config: GameConfig, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < config.width && y < config.height;
}

export function isBorderCell(config: GameConfig, x: number, y: number): boolean {
  return x === 0 || y === 0 || x === config.width - 1 || y === config.height - 1;
}

/** A cell is "solid" (walkable edge / wall) when it is not open unclaimed space. */
export function isSolid(owner: Uint8Array, i: number): boolean {
  return owner[i] !== UNCLAIMED;
}

export function createOwnerGrid(config: GameConfig): Uint8Array {
  const owner = new Uint8Array(config.width * config.height);
  for (let x = 0; x < config.width; x++) {
    owner[idx(config, x, 0)] = BORDER;
    owner[idx(config, x, config.height - 1)] = BORDER;
  }
  for (let y = 0; y < config.height; y++) {
    owner[idx(config, 0, y)] = BORDER;
    owner[idx(config, config.width - 1, y)] = BORDER;
  }
  return owner;
}

export function interiorCellCount(config: GameConfig): number {
  return (config.width - 2) * (config.height - 2);
}

// mulberry32 seeded RNG — deterministic, small state.
export function nextRandom(state: number): { value: number; state: number } {
  let s = (state + 0x6d2b79f5) | 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const value = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return { value, state: s };
}
