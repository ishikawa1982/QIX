import { describe, expect, it } from 'vitest';
import { createGame, ownedPercent, setPlayerDir, step } from './simulation';
import { idx } from './grid';
import { BORDER, UNCLAIMED, type GameConfig } from './types';

function baseConfig(overrides: Partial<GameConfig> = {}): GameConfig {
  return {
    width: 9,
    height: 9,
    targetFraction: 0.75,
    timeLimit: 0,
    startLives: 3,
    playerSpeed: 1, // 1 cell per step when dt = 1
    enemySpeed: 0, // enemies stay put unless we want them to move
    ...overrides,
  };
}

describe('grid setup', () => {
  it('initializes the border and interior count', () => {
    const state = createGame({ config: baseConfig(), playerCount: 1, enemyCount: 0 });
    expect(state.interiorTotal).toBe(7 * 7);
    expect(state.owner[idx(state.config, 0, 0)]).toBe(BORDER);
    expect(state.owner[idx(state.config, 4, 0)]).toBe(BORDER);
    expect(state.owner[idx(state.config, 4, 4)]).toBe(UNCLAIMED);
  });
});

describe('territory claiming', () => {
  it('claims the whole interior when no enemy is present', () => {
    const state = createGame({ config: baseConfig(), playerCount: 1, enemyCount: 0 });
    const p = state.players[0];
    p.x = 4;
    p.y = 0; // start on the top border
    setPlayerDir(state, 1, 'down');
    for (let i = 0; i < 12; i++) {
      step(state, 1);
      if (!p.drawing && p.owned > 0) break;
    }
    expect(p.owned).toBe(7 * 7);
    expect(ownedPercent(state, 1)).toBeCloseTo(100);
  });

  it('claims only the side without the enemy', () => {
    const state = createGame({ config: baseConfig(), playerCount: 1, enemyCount: 1 });
    const p = state.players[0];
    p.x = 4;
    p.y = 0;
    // Park the enemy in the LEFT half so the RIGHT half gets sealed & claimed.
    state.enemies[0].x = 2;
    state.enemies[0].y = 4;
    setPlayerDir(state, 1, 'down');
    for (let i = 0; i < 12; i++) {
      step(state, 1);
      if (!p.drawing && p.owned > 0) break;
    }
    // Column x=4 (7 trail cells) + right half (x=5..7, 7 rows = 21) = 28.
    expect(p.owned).toBe(28);
    // A left-half interior cell remains open, a right-half cell is owned.
    expect(state.owner[idx(state.config, 2, 3)]).toBe(UNCLAIMED);
    expect(state.owner[idx(state.config, 6, 3)]).toBe(1);
  });
});

describe('enemy collision', () => {
  it('costs a life and erases the trail when the enemy hits the line', () => {
    const state = createGame({ config: baseConfig(), playerCount: 1, enemyCount: 1 });
    const p = state.players[0];
    // Give the player an in-progress trail cell.
    const trailCell = idx(state.config, 4, 3);
    p.drawing = true;
    p.trail = [trailCell];
    state.trailOwner[trailCell] = 1;
    p.x = 4;
    p.y = 3;
    // Put the enemy right on the trail cell.
    state.enemies[0].x = 4;
    state.enemies[0].y = 3;
    setPlayerDir(state, 1, 'none');

    const before = p.lives;
    step(state, 1);

    expect(p.lives).toBe(before - 1);
    expect(p.drawing).toBe(false);
    expect(p.trail.length).toBe(0);
    expect(state.trailOwner[trailCell]).toBe(0);
  });
});
