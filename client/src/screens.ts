// DOM screen management. Each show* method replaces the #app content and
// returns handles the game logic uses to update live values.
import { PLAYER_COLORS, type PlayerMeta } from '@shared/types';

export interface HudPlayer {
  id: number;
  name: string;
  color: string;
  percent: number;
  lives?: number;
  you: boolean;
}

export interface HudData {
  players: HudPlayer[];
  timeLeft?: number;
  target: number;
  message?: string;
}

export interface GameHandles {
  canvas: HTMLCanvasElement;
  controls: HTMLElement;
  setHud: (data: HudData) => void;
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text !== undefined) e.textContent = text;
  return e;
}

export class UI {
  private root: HTMLElement;

  constructor() {
    this.root = document.getElementById('app')!;
  }

  private mount(screen: HTMLElement): void {
    this.root.replaceChildren(screen);
  }

  showTitle(onStart: () => void): void {
    const s = el('div', 'screen');
    const c = el('div', 'center');
    c.append(
      el('div', 'logo', 'QIX'),
      el('div', 'tagline', 'スマホで遊べる陣取りバトル。1人でも、最大4人のオンライン対戦でも。'),
    );
    const btn = el('button', 'btn', 'はじめる');
    btn.addEventListener('click', onStart);
    c.append(btn);
    s.append(c);
    this.mount(s);
  }

  showMenu(name: string, onName: (n: string) => void, onSolo: () => void, onOnline: () => void): void {
    const s = el('div', 'screen');
    const c = el('div', 'center');
    c.append(el('div', 'logo', 'QIX'));

    const nameField = el('input', 'field') as HTMLInputElement;
    nameField.placeholder = 'なまえ';
    nameField.maxLength = 10;
    nameField.value = name;
    nameField.addEventListener('input', () => onName(nameField.value));
    c.append(nameField);

    const solo = el('button', 'btn', '1人で遊ぶ（ソロ）');
    solo.addEventListener('click', onSolo);
    const online = el('button', 'btn secondary', 'オンライン対戦（最大4人）');
    online.addEventListener('click', onOnline);
    c.append(solo, online);
    s.append(c);
    this.mount(s);
  }

  showOnlineEntry(onCreate: () => void, onJoin: (code: string) => void, onBack: () => void): void {
    const s = el('div', 'screen');
    const c = el('div', 'center');
    c.append(el('div', 'logo', '対戦'));

    const create = el('button', 'btn', 'ルームを作る');
    create.addEventListener('click', onCreate);
    c.append(create);

    c.append(el('div', 'hint', '― または ―'));

    const codeField = el('input', 'field code') as HTMLInputElement;
    codeField.placeholder = 'コード';
    codeField.maxLength = 4;
    codeField.autocapitalize = 'characters';
    const join = el('button', 'btn secondary', 'コードで参加');
    join.addEventListener('click', () => {
      const code = codeField.value.trim().toUpperCase();
      if (code.length >= 4) onJoin(code);
    });
    c.append(codeField, join);

    const back = el('button', 'btn secondary', '戻る');
    back.addEventListener('click', onBack);
    c.append(back);
    s.append(c);
    this.mount(s);
  }

  showConnecting(): void {
    const s = el('div', 'screen');
    const c = el('div', 'center');
    c.append(el('div', 'tagline', '接続中…'));
    s.append(c);
    this.mount(s);
  }

  showLobby(code: string, isHost: boolean, onStart: () => void, onBack: () => void): (players: PlayerMeta[], canStart: boolean) => void {
    const s = el('div', 'screen');
    const c = el('div', 'center');
    c.append(el('div', 'hint', 'このコードを友達に共有'));
    c.append(el('div', 'roomcode', code));

    const list = el('div', 'playerlist');
    c.append(list);

    const startBtn = el('button', 'btn', isHost ? 'ゲーム開始' : 'ホストの開始を待っています');
    startBtn.disabled = true;
    if (isHost) startBtn.addEventListener('click', onStart);
    c.append(startBtn);

    const back = el('button', 'btn secondary', '退出');
    back.addEventListener('click', onBack);
    c.append(back);

    s.append(c);
    this.mount(s);

    return (players: PlayerMeta[], canStart: boolean) => {
      list.replaceChildren();
      for (const p of players) {
        const item = el('div', 'playeritem');
        const chip = el('span', 'chip');
        chip.style.background = p.color;
        item.append(chip, el('span', undefined, p.name || `P${p.id}`));
        list.append(item);
      }
      if (isHost) startBtn.disabled = !canStart;
    };
  }

  showGame(): GameHandles {
    const s = el('div', 'screen game');

    const hud = el('div', 'hud');
    const hudTop = el('div', 'hud-top');
    const targetLabel = el('span');
    const timer = el('span', 'hud-timer');
    hudTop.append(targetLabel, timer);
    const players = el('div', 'hud-players');
    hud.append(hudTop, players);

    const playfield = el('div', 'playfield');
    const canvas = el('canvas');
    playfield.append(canvas);

    const controls = el('div', 'controls');

    s.append(hud, playfield, controls);
    this.mount(s);

    const setHud = (data: HudData) => {
      targetLabel.textContent = `目標 ${Math.round(data.target)}%`;
      if (data.timeLeft !== undefined) {
        const t = Math.max(0, Math.ceil(data.timeLeft));
        timer.textContent = `残り ${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
      } else {
        timer.textContent = data.message ?? '';
      }
      players.replaceChildren();
      for (const p of data.players) {
        const row = el('div', 'hud-player');
        const chip = el('span', 'chip');
        chip.style.background = p.color;
        const name = el('span', 'hud-name', p.you ? `${p.name}(あなた)` : p.name);
        const bar = el('div', 'bar');
        const fill = el('span');
        fill.style.width = `${Math.min(100, p.percent)}%`;
        fill.style.background = p.color;
        bar.append(fill);
        const pct = el('span', 'hud-pct', `${p.percent.toFixed(1)}%`);
        row.append(chip, name, bar, pct);
        if (p.lives !== undefined) {
          row.append(el('span', 'hearts', '♥'.repeat(Math.max(0, p.lives))));
        }
        players.append(row);
      }
    };

    return { canvas, controls, setHud };
  }

  showResult(
    title: string,
    rows: { name: string; percent: number; color: string; you: boolean }[],
    onReplay: () => void,
    onMenu: () => void,
  ): void {
    const s = el('div', 'screen');
    const c = el('div', 'center');
    c.append(el('div', 'logo', title));
    const list = el('div', 'ranklist');
    rows.forEach((r, i) => {
      const item = el('div', 'rankitem');
      item.append(el('span', 'place', `${i + 1}`));
      const chip = el('span', 'chip');
      chip.style.background = r.color;
      item.append(chip);
      item.append(el('span', 'grow', r.you ? `${r.name}(あなた)` : r.name));
      item.append(el('span', undefined, `${r.percent.toFixed(1)}%`));
      list.append(item);
    });
    c.append(list);

    const replay = el('button', 'btn', 'もう一度');
    replay.addEventListener('click', onReplay);
    const menu = el('button', 'btn secondary', 'メニューへ');
    menu.addEventListener('click', onMenu);
    c.append(replay, menu);
    s.append(c);
    this.mount(s);
  }

  toast(message: string): void {
    const t = el('div', 'toast', message);
    document.body.append(t);
    setTimeout(() => t.remove(), 2600);
  }
}

export function colorFor(id: number): string {
  return PLAYER_COLORS[(id - 1) % PLAYER_COLORS.length];
}
