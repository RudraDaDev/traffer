/**
 * Pointer, gesture and keyboard input.
 *
 * One finger / left button drives the active tool. Two fingers pan and pinch.
 * Right/middle drag, space+drag, the wheel and the arrow keys are the desktop
 * equivalents, so the game feels native on both.
 */

import { clamp, dist, type Vec2 } from '../core/math';

export interface InputHandlers {
  /** tool press began (world coords) */
  onDown(p: Vec2, ev: PointerEvent, tap: boolean): void;
  onMove(p: Vec2, ev: PointerEvent): void;
  onUp(p: Vec2, ev: PointerEvent): void;
  /** a quick tap without dragging */
  onTap?(p: Vec2, ev: PointerEvent): void;
  /** pan in world units (already scaled by zoom) */
  onPan(dx: number, dy: number): void;
  /** multiplicative zoom around a screen point */
  onZoom(factor: number, sx: number, sy: number): void;
  onHover(p: Vec2 | null, ev: PointerEvent): void;
  onKey(key: string, ev: KeyboardEvent): void;
  /** a second finger landed: abort whatever the first was doing */
  onGestureStart(): void;
  onGestureEnd(): void;
}

interface Pointer {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  t0: number;
  button: number;
  moved: number;
}

export class Input {
  private canvas: HTMLCanvasElement;
  private h: InputHandlers;
  private pointers = new Map<number, Pointer>();
  private gesture: { d0: number; mid: Vec2; lastMid: Vec2 } | null = null;
  private panning = false;
  private spaceDown = false;
  /** screen-space position of the single active pointer, or null */
  hoverScreen: Vec2 | null = null;
  private cleanups: (() => void)[] = [];
  enabled = true;

  constructor(canvas: HTMLCanvasElement, handlers: InputHandlers) {
    this.canvas = canvas;
    this.h = handlers;
    this.attach();
  }

  destroy(): void {
    for (const c of this.cleanups) c();
    this.cleanups = [];
  }

  private rect(): DOMRect {
    return this.canvas.getBoundingClientRect();
  }

  private local(ev: { clientX: number; clientY: number }): Vec2 {
    const r = this.rect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }

  private attach(): void {
    const c = this.canvas;
    const add = <K extends keyof HTMLElementEventMap>(
      target: HTMLElement | Window,
      type: K,
      fn: (ev: HTMLElementEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ) => {
      target.addEventListener(type as string, fn as EventListener, opts);
      this.cleanups.push(() => target.removeEventListener(type as string, fn as EventListener, opts));
    };

    add(c, 'pointerdown', (ev: PointerEvent) => {
      if (!this.enabled) return;
      ev.preventDefault();
      const p = this.local(ev);
      const ptr: Pointer = {
        id: ev.pointerId,
        x: p.x,
        y: p.y,
        startX: p.x,
        startY: p.y,
        t0: performance.now(),
        button: ev.button,
        moved: 0,
      };
      this.pointers.set(ev.pointerId, ptr);
      try {
        c.setPointerCapture(ev.pointerId);
      } catch {
        /* ignore */
      }

      if (this.pointers.size === 2) {
        // second finger: cancel the stroke and start a pinch/pan gesture
        const [a, b] = [...this.pointers.values()];
        this.gesture = {
          d0: Math.max(8, dist(a, b)),
          mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
          lastMid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
        };
        this.h.onGestureStart();
        return;
      }
      if (this.pointers.size > 2) return;

      this.panning = ev.button === 1 || ev.button === 2 || this.spaceDown;
      if (!this.panning) this.h.onDown(p, ev, false);
      document.body.classList.add('dragging');
    });

    add(c, 'pointermove', (ev: PointerEvent) => {
      if (!this.enabled) return;
      const p = this.local(ev);
      this.hoverScreen = p;
      const ptr = this.pointers.get(ev.pointerId);
      if (!ptr) {
        this.h.onHover(p, ev);
        return;
      }
      const prevX = ptr.x;
      const prevY = ptr.y;
      ptr.moved += Math.abs(p.x - prevX) + Math.abs(p.y - prevY);
      ptr.x = p.x;
      ptr.y = p.y;

      if (this.gesture && this.pointers.size >= 2) {
        ev.preventDefault();
        const [a, b] = [...this.pointers.values()];
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        const d = Math.max(8, dist(a, b));
        const factor = clamp(d / this.gesture.d0, 0.4, 2.5);
        this.gesture.d0 = d;
        this.h.onZoom(factor, mid.x, mid.y);
        this.h.onPan(mid.x - this.gesture.lastMid.x, mid.y - this.gesture.lastMid.y);
        this.gesture.lastMid = mid;
        return;
      }
      if (this.panning) {
        ev.preventDefault();
        this.h.onPan(p.x - prevX, p.y - prevY);
        return;
      }
      this.h.onMove(p, ev);
    });

    const endPointer = (ev: PointerEvent) => {
      const ptr = this.pointers.get(ev.pointerId);
      if (!ptr) return;
      this.pointers.delete(ev.pointerId);
      try {
        this.canvas.releasePointerCapture(ev.pointerId);
      } catch {
        /* ignore */
      }
      const p = this.local(ev);
      const quick = performance.now() - ptr.t0 < 300 && ptr.moved < 10;

      if (this.gesture) {
        if (this.pointers.size < 2) {
          this.gesture = null;
          this.h.onGestureEnd();
        }
        document.body.classList.remove('dragging');
        return;
      }
      if (this.panning) {
        this.panning = false;
        document.body.classList.remove('dragging');
        return;
      }
      this.h.onUp(p, ev);
      if (quick) this.h.onTap?.(p, ev);
      if (!this.pointers.size) document.body.classList.remove('dragging');
    };

    add(c, 'pointerup', endPointer);
    add(c, 'pointercancel', endPointer);
    add(c, 'pointerleave', (ev: PointerEvent) => {
      if (!this.pointers.has(ev.pointerId)) {
        this.hoverScreen = null;
        this.h.onHover(null, ev);
      }
    });
    add(c, 'contextmenu', (ev: MouseEvent) => ev.preventDefault());

    add(
      c,
      'wheel',
      (ev: WheelEvent) => {
        if (!this.enabled) return;
        ev.preventDefault();
        const p = this.local(ev);
        if (ev.shiftKey && !ev.ctrlKey) {
          this.h.onPan(-ev.deltaY * 0.6, -ev.deltaX * 0.6);
          return;
        }
        const unit = ev.deltaMode === 1 ? 16 : ev.deltaMode === 2 ? 400 : 1;
        const factor = Math.exp(-clamp(ev.deltaY * unit, -260, 260) * 0.0022);
        this.h.onZoom(factor, p.x, p.y);
      },
      { passive: false },
    );

    add(window, 'keydown', (ev: KeyboardEvent) => {
      if (ev.code === 'Space') this.spaceDown = true;
      const target = ev.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab'].includes(ev.code)) ev.preventDefault();
      this.h.onKey(ev.key.length === 1 ? ev.key.toLowerCase() : ev.code, ev);
    });

    add(window, 'keyup', (ev: KeyboardEvent) => {
      if (ev.code === 'Space') this.spaceDown = false;
    });

    add(window, 'blur', () => {
      this.spaceDown = false;
      this.pointers.clear();
      this.gesture = null;
      this.panning = false;
      document.body.classList.remove('dragging');
    });
  }

  /** Screen-space delta converted to world units by the caller. */
  get activePointers(): number {
    return this.pointers.size;
  }

  cancelAll(): void {
    this.pointers.clear();
    if (this.gesture) {
      this.gesture = null;
      this.h.onGestureEnd();
    }
    this.panning = false;
    document.body.classList.remove('dragging');
  }
}

/** Screen delta (css px) -> world delta given a zoom level. */
export function screenDeltaToWorld(dxScreen: number, dyScreen: number, zoom: number): Vec2 {
  return { x: -dxScreen / zoom, y: -dyScreen / zoom };
}
