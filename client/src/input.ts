// Touch/keyboard controls. Renders a virtual D-pad and reports direction
// changes. Holding a button moves; releasing stops.
import type { Dir } from '@shared/types';

export class Controls {
  private dir: Dir = 'none';
  private activePointer: number | null = null;

  constructor(private container: HTMLElement, private onDir: (dir: Dir) => void) {
    this.buildPad();
    this.bindKeyboard();
  }

  private set(dir: Dir): void {
    if (dir === this.dir) return;
    this.dir = dir;
    this.onDir(dir);
  }

  private buildPad(): void {
    const pad = document.createElement('div');
    pad.className = 'dpad';
    const buttons: { dir: Dir; label: string; cls: string }[] = [
      { dir: 'up', label: '▲', cls: 'up' },
      { dir: 'left', label: '◀', cls: 'left' },
      { dir: 'right', label: '▶', cls: 'right' },
      { dir: 'down', label: '▼', cls: 'down' },
    ];
    for (const b of buttons) {
      const el = document.createElement('button');
      el.className = `dbtn ${b.cls}`;
      el.textContent = b.label;
      el.setAttribute('aria-label', b.dir);
      const press = (e: PointerEvent) => {
        e.preventDefault();
        this.activePointer = e.pointerId;
        el.classList.add('active');
        this.set(b.dir);
      };
      const release = (e: PointerEvent) => {
        e.preventDefault();
        el.classList.remove('active');
        if (this.dir === b.dir) this.set('none');
        this.activePointer = null;
      };
      el.addEventListener('pointerdown', press);
      el.addEventListener('pointerup', release);
      el.addEventListener('pointercancel', release);
      el.addEventListener('pointerleave', (e) => {
        if (this.activePointer === e.pointerId) release(e);
      });
      pad.appendChild(el);
    }
    this.container.appendChild(pad);
  }

  private bindKeyboard(): void {
    const map: Record<string, Dir> = {
      ArrowUp: 'up',
      ArrowDown: 'down',
      ArrowLeft: 'left',
      ArrowRight: 'right',
      w: 'up',
      s: 'down',
      a: 'left',
      d: 'right',
    };
    window.addEventListener('keydown', (e) => {
      const dir = map[e.key];
      if (dir) {
        e.preventDefault();
        this.set(dir);
      }
    });
    window.addEventListener('keyup', (e) => {
      const dir = map[e.key];
      if (dir && this.dir === dir) this.set('none');
    });
  }
}
