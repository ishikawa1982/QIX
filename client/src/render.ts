// Canvas renderer. Draws the grid to a small offscreen buffer (one pixel per
// cell) then scales it up crisply, with players and enemies drawn on top.
import { BORDER, UNCLAIMED, type GameConfig } from '@shared/types';

export interface RenderView {
  config: GameConfig;
  owner: Uint8Array;
  trailOwner: Uint8Array;
  players: { id: number; x: number; y: number; color: string; drawing: boolean; respawn?: boolean }[];
  enemies: { x: number; y: number }[];
  youId?: number;
}

type RGB = [number, number, number];

const UNCLAIMED_RGB: RGB = [12, 17, 33];
const BORDER_RGB: RGB = [45, 54, 84];

const PLAYER_RGB: RGB[] = [
  [34, 211, 238],
  [244, 114, 182],
  [163, 230, 53],
  [251, 146, 60],
];

function dim([r, g, b]: RGB, f: number): RGB {
  return [Math.round(r * f), Math.round(g * f), Math.round(b * f)];
}

export class Renderer {
  private ctx: CanvasRenderingContext2D;
  private buffer: HTMLCanvasElement;
  private bufCtx: CanvasRenderingContext2D;
  private image: ImageData;
  private cssW = 0;
  private cssH = 0;
  private cell = 1;
  private offX = 0;
  private offY = 0;

  constructor(private canvas: HTMLCanvasElement, private config: GameConfig) {
    this.ctx = canvas.getContext('2d')!;
    this.buffer = document.createElement('canvas');
    this.buffer.width = config.width;
    this.buffer.height = config.height;
    this.bufCtx = this.buffer.getContext('2d')!;
    this.image = this.bufCtx.createImageData(config.width, config.height);
    this.resize();
  }

  resize(): void {
    const parent = this.canvas.parentElement!;
    const availW = parent.clientWidth;
    const availH = parent.clientHeight;
    const aspect = this.config.width / this.config.height;
    let w = availW;
    let h = w / aspect;
    if (h > availH) {
      h = availH;
      w = h * aspect;
    }
    this.cssW = Math.floor(w);
    this.cssH = Math.floor(h);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.canvas.width = Math.floor(this.cssW * dpr);
    this.canvas.height = Math.floor(this.cssH * dpr);
    this.canvas.style.width = `${this.cssW}px`;
    this.canvas.style.height = `${this.cssH}px`;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx.imageSmoothingEnabled = false;
    this.cell = this.cssW / this.config.width;
    this.offX = 0;
    this.offY = 0;
  }

  private paintGrid(view: RenderView): void {
    const { owner, trailOwner } = view;
    const data = this.image.data;
    for (let i = 0; i < owner.length; i++) {
      let rgb: RGB;
      const tOwner = trailOwner[i];
      if (tOwner !== 0) {
        rgb = PLAYER_RGB[(tOwner - 1) % PLAYER_RGB.length];
      } else {
        const o = owner[i];
        if (o === UNCLAIMED) rgb = UNCLAIMED_RGB;
        else if (o === BORDER) rgb = BORDER_RGB;
        else rgb = dim(PLAYER_RGB[(o - 1) % PLAYER_RGB.length], 0.55);
      }
      const j = i * 4;
      data[j] = rgb[0];
      data[j + 1] = rgb[1];
      data[j + 2] = rgb[2];
      data[j + 3] = 255;
    }
    this.bufCtx.putImageData(this.image, 0, 0);
  }

  draw(view: RenderView): void {
    this.paintGrid(view);
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.cssW, this.cssH);
    ctx.drawImage(this.buffer, this.offX, this.offY, this.cssW, this.cssH);

    const cell = this.cell;

    // Enemies (QIX): pulsing diamonds.
    const t = performance.now() / 300;
    for (const e of view.enemies) {
      const cx = (e.x + 0.5) * cell;
      const cy = (e.y + 0.5) * cell;
      const r = cell * (2.2 + Math.sin(t) * 0.5);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(t);
      ctx.fillStyle = '#ef4444';
      ctx.shadowColor = '#ef4444';
      ctx.shadowBlur = 8;
      ctx.beginPath();
      ctx.moveTo(0, -r);
      ctx.lineTo(r, 0);
      ctx.lineTo(0, r);
      ctx.lineTo(-r, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // Player markers.
    for (const p of view.players) {
      const cx = (p.x + 0.5) * cell;
      const cy = (p.y + 0.5) * cell;
      const r = Math.max(3, cell * 1.6);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = p.respawn ? 0.4 : 1;
      ctx.shadowColor = p.color;
      ctx.shadowBlur = p.id === view.youId ? 12 : 4;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.shadowBlur = 0;
      if (p.id === view.youId) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }
}
