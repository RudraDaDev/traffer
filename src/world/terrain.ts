/**
 * Procedural terrain.
 *
 * The world is a square of `size` world units. Types are stored on a coarse
 * grid (one cell = CELL world units) which keeps generation fast even on
 * phones; the painted texture is upscaled with bilinear sampling so shores and
 * forest edges look soft instead of blocky.
 */

import { Noise2D, RNG, hashString, mixSeeds } from '../core/rng';
import { clamp, clamp01, smoothstep, type Vec2 } from '../core/math';
import type { TerrainSpec } from '../game/types';

export const T_DEEP = 0;
export const T_WATER = 1;
export const T_SAND = 2;
export const T_GRASS = 3;
export const T_FOREST = 4;
export const T_ROCK = 5;
export const T_URBAN = 6;
export const T_BLOCK = 7; // built-up block: cannot be driven through / built on

export const CELL = 4; // world units per terrain grid cell

interface RGB {
  r: number;
  g: number;
  b: number;
}

const PALETTE: RGB[] = [
  { r: 12, g: 38, b: 58 }, // deep water
  { r: 24, g: 74, b: 104 }, // water
  { r: 196, g: 178, b: 132 }, // sand
  { r: 78, g: 116, b: 72 }, // grass
  { r: 47, g: 84, b: 52 }, // forest
  { r: 99, g: 97, b: 92 }, // rock
  { r: 96, g: 100, b: 102 }, // urban ground
  { r: 66, g: 72, b: 78 }, // city block
];

export class Terrain {
  size: number;
  cols: number;
  rows: number;
  types: Uint8Array;
  heights: Float32Array;
  colors: Uint8Array; // rgb per cell, 3 bytes
  blocked: Uint8Array; // 1 = cannot build here (city blocks, parks)
  /** height value at the shoreline — used when reclaiming land for districts */
  seaLevel = 0;
  seed: number;
  spec: TerrainSpec;
  private rng!: RNG;
  private noise!: Noise2D;
  private noise2!: Noise2D;

  constructor(size: number) {
    this.size = size;
    this.cols = Math.max(8, Math.ceil(size / CELL));
    this.rows = this.cols;
    this.types = new Uint8Array(this.cols * this.rows);
    this.heights = new Float32Array(this.cols * this.rows);
    this.colors = new Uint8Array(this.cols * this.rows * 3);
    this.blocked = new Uint8Array(this.cols * this.rows);
    this.seed = 1;
    this.spec = {};
  }

  idx(cx: number, cy: number): number {
    return cy * this.cols + cx;
  }

  cellOf(x: number): number {
    return clamp(Math.floor(x / CELL), 0, this.cols - 1);
  }

  typeAt(x: number, y: number): number {
    return this.types[this.idx(this.cellOf(x), this.cellOf(y))];
  }

  isWater(x: number, y: number): boolean {
    const t = this.typeAt(x, y);
    return t === T_WATER || t === T_DEEP;
  }

  isBlocked(x: number, y: number): boolean {
    return this.blocked[this.idx(this.cellOf(x), this.cellOf(y))] === 1;
  }

  heightAt(x: number, y: number): number {
    return this.heights[this.idx(this.cellOf(x), this.cellOf(y))];
  }

  /** Fraction of a segment covered by water — used to price bridges. */
  waterFraction(a: Vec2, b: Vec2, samples = 0): number {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = samples > 0 ? samples : Math.max(4, Math.ceil(len / (CELL * 1.5)));
    let w = 0;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (this.isWater(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) w++;
    }
    return w / (n + 1);
  }

  blockedFraction(a: Vec2, b: Vec2): number {
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(4, Math.ceil(len / (CELL * 1.5)));
    let w = 0;
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (this.isBlocked(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) w++;
    }
    return w / (n + 1);
  }

  // ---------------------------------------------------------------- generate

  generate(seedStr: string, spec: TerrainSpec = {}): Terrain {
    this.spec = spec;
    this.seed = hashString(seedStr);
    const rng = new RNG(this.seed);
    this.rng = rng;
    this.noise = new Noise2D(new RNG(mixSeeds(this.seed, 'h')));
    this.noise2 = new Noise2D(new RNG(mixSeeds(this.seed, 'm')));

    const { cols, rows } = this;
    const seaFrac = clamp01(spec.sea ?? 0.05);
    const forestAmt = spec.forest ?? 0.28;
    const rockAmt = spec.rock ?? 0.1;
    const border = spec.border ?? (spec.coast && spec.coast !== 'none' ? 'island' : 'soft');
    // noise frequency in "features across the map", independent of cell count
    const freq = 2.6;

    // 1. base height field -------------------------------------------------
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const nx = (cx / cols) * freq;
        const ny = (cy / rows) * freq;
        let h = this.noise.fbm(nx * 2.1, ny * 2.1, 4) * 0.6;
        h += this.noise.ridged(nx * 1.1 + 31.7, ny * 1.1 - 12.3, 3) * 0.3 * (0.3 + rockAmt * 1.6);
        h += this.noise2.fbm(nx * 6.4, ny * 6.4, 2) * 0.1;

        // border shaping
        const ex = Math.min(cx, cols - 1 - cx) / (cols * 0.5);
        const ey = Math.min(cy, rows - 1 - cy) / (rows * 0.5);
        const edge = Math.min(ex, ey);
        if (border === 'island') {
          const falloff = smoothstep(edge / 0.42);
          h = h * (0.3 + 0.7 * falloff) - (1 - falloff) * 0.75;
        } else if (border === 'soft') {
          const falloff = smoothstep(edge / 0.12);
          h = h * (0.82 + 0.18 * falloff) - (1 - falloff) * 0.22;
        }

        if (spec.coast && spec.coast !== 'none') {
          const t = this.coastFalloff(cx / cols, cy / rows, spec.coast);
          h = h * (1 - t) + t * -0.95;
        }
        this.heights[this.idx(cx, cy)] = h;
      }
    }

    // 1b. percentile thresholds so `sea`/`rock` mean what the designer thinks
    const sorted = Float32Array.from(this.heights).sort();
    const q = (f: number) => sorted[clamp(Math.floor(f * (sorted.length - 1)), 0, sorted.length - 1)];
    const seaLevel = q(seaFrac * 0.86);
    const deepLevel = q(seaFrac * 0.45);
    const sandLevel = q(seaFrac * 0.86 + 0.028);
    const rockLevel = q(1 - clamp01(rockAmt) * 0.9);
    const range = Math.max(0.05, sorted[sorted.length - 1] - sorted[0]);
    this.seaLevel = seaLevel;

    // 2. rivers -------------------------------------------------------------
    const riverCount = spec.rivers ?? 0;
    const riverW = spec.riverWidth ?? Math.max(9, this.size * 0.026);
    const riverField = riverCount > 0 ? new Float32Array(cols * rows) : null;
    for (let r = 0; r < riverCount; r++) {
      const pts = this.makeRiver(spec.riverDir ?? 'any', r, riverCount);
      this.stampPath(riverField!, pts, riverW * (0.8 + 0.4 * rng.next()));
    }

    // 3. lakes ---------------------------------------------------------------
    const lakeField = new Float32Array(cols * rows);
    const lakes = spec.lakes ?? 0;
    const lakeNoise = new Noise2D(rng.fork('lakes'));
    for (let l = 0; l < lakes; l++) {
      const cx = rng.float(0.18, 0.82) * cols;
      const cy = rng.float(0.18, 0.82) * rows;
      const rad = rng.float(0.07, 0.15) * cols;
      const squash = rng.float(0.65, 1.3);
      const rot = rng.float(0, Math.PI);
      const cr = Math.cos(rot);
      const sr = Math.sin(rot);
      for (let y = Math.max(0, Math.floor(cy - rad * 1.5)); y <= Math.min(rows - 1, Math.ceil(cy + rad * 1.5)); y++) {
        for (let x = Math.max(0, Math.floor(cx - rad * 1.5)); x <= Math.min(cols - 1, Math.ceil(cx + rad * 1.5)); x++) {
          const dx = x - cx;
          const dy = (y - cy) * squash;
          const rx = dx * cr - dy * sr;
          const ry = dx * sr + dy * cr;
          // wobble the shoreline with noise so lakes never look stamped out
          const wob = 1 + lakeNoise.at(x * 0.09 + l * 13.7, y * 0.09 - l * 7.3) * 0.42;
          const d = Math.hypot(rx, ry) / (rad * wob);
          if (d > 1.25) continue;
          const w = 1 - smoothstep(d);
          const i = this.idx(x, y);
          if (w > lakeField[i]) lakeField[i] = w;
        }
      }
    }

    // 4. classify -------------------------------------------------------------
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const i = this.idx(cx, cy);
        const h = this.heights[i];
        const riv = riverField ? riverField[i] : 0;
        const lake = lakeField[i];
        let t: number;
        if (riv > 0.06 || lake > 0.14 || h < deepLevel) t = T_DEEP;
        else if (h < seaLevel) t = T_WATER;
        else if (h < sandLevel) t = T_SAND;
        else if (h > rockLevel) t = T_ROCK;
        else {
          const m = this.noise2.fbm((cx / cols) * 9 + 7, (cy / rows) * 9 - 3, 3);
          const hn = (h - sandLevel) / range;
          t = m > 0.34 - forestAmt * 0.62 - hn * 0.1 ? T_FOREST : T_GRASS;
        }
        this.types[i] = t;
        // keep a smooth height field for shading even where we forced water
        if (riv > 0.06 || lake > 0.14) this.heights[i] = Math.min(h, deepLevel);
      }
    }

    // 5. beaches: any land next to water becomes sand ------------------------
    const copy = this.types.slice();
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const i = this.idx(cx, cy);
        if (copy[i] !== T_GRASS && copy[i] !== T_FOREST) continue;
        let near = false;
        for (let dy = -1; dy <= 1 && !near; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx;
            const ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
            const t = copy[this.idx(nx, ny)];
            if (t === T_WATER || t === T_DEEP) {
              near = true;
              break;
            }
          }
        }
        if (near) this.types[i] = T_SAND;
      }
    }

    // 6. urban patches & forbidden blocks ------------------------------------
    for (const [fx, fy, fr] of spec.urban ?? []) {
      this.stampCircle(fx * cols, fy * rows, fr * cols, T_URBAN, false);
    }
    for (const [fx, fy, fr] of spec.blocks ?? []) {
      this.stampCircle(fx * cols, fy * rows, fr * cols, T_BLOCK, true);
    }

    // 7. colours --------------------------------------------------------------
    this.paintCells();
    return this;
  }

  private coastFalloff(u: number, v: number, coast: string): number {
    switch (coast) {
      case 'n':
        return smoothstep((0.3 - v) / 0.3);
      case 's':
        return smoothstep((v - 0.7) / 0.3);
      case 'w':
        return smoothstep((0.3 - u) / 0.3);
      case 'e':
        return smoothstep((u - 0.7) / 0.3);
      default:
        return 0;
    }
  }

  private makeRiver(dir: 'h' | 'v' | 'd' | 'any', index: number, count: number): Vec2[] {
    const rng = this.rng.fork('river' + index);
    const { cols, rows } = this;
    let d = dir;
    if (d === 'any') d = rng.pick(['h', 'v', 'd', 'd'] as ('h' | 'v' | 'd')[]);
    const pts: Vec2[] = [];
    const steps = 46;
    const amp = rng.float(0.08, 0.2);
    const phase = rng.float(0, Math.PI * 2);
    const wobble = rng.float(1.1, 2.6);
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const wig = Math.sin(t * Math.PI * wobble + phase) * amp + Math.sin(t * Math.PI * 5.3 + phase * 2) * amp * 0.35;
      let x: number;
      let y: number;
      if (d === 'h') {
        x = t * cols;
        y = (0.28 + 0.44 * ((index + 1) / (count + 1))) * rows + wig * rows;
      } else if (d === 'v') {
        y = t * rows;
        x = (0.28 + 0.44 * ((index + 1) / (count + 1))) * cols + wig * cols;
      } else {
        const diag = rng.chance(0.5) ? 1 : -1;
        x = t * cols;
        y = (diag > 0 ? t : 1 - t) * rows + wig * rows;
      }
      pts.push({ x, y });
    }
    return pts;
  }

  /** Paint a soft distance stamp of a polyline (in cell space) into `field`. */
  private stampPath(field: Float32Array, pts: Vec2[], widthCells: number): void {
    const w = widthCells / CELL;
    const step = Math.max(0.35, w * 0.35);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const segLen = Math.hypot(b.x - a.x, b.y - a.y);
      const n = Math.max(1, Math.ceil(segLen / step));
      for (let s = 0; s <= n; s++) {
        const t = s / n;
        this.stampDisc(field, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, w);
      }
    }
  }

  private stampDisc(field: Float32Array, cx: number, cy: number, r: number): void {
    const { cols, rows } = this;
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(cols - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(rows - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - cx, y - cy) / r;
        if (d > 1) continue;
        const w = 1 - smoothstep(d);
        const i = this.idx(x, y);
        if (w > field[i]) field[i] = w;
      }
    }
  }

  private stampCircle(cx: number, cy: number, r: number, type: number, block: boolean): void {
    const { cols, rows } = this;
    const x0 = Math.max(0, Math.floor(cx - r));
    const x1 = Math.min(cols - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r));
    const y1 = Math.min(rows - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - cx, y - cy) / r;
        if (d > 1) continue;
        const i = this.idx(x, y);
        const w = 1 - smoothstep(d);
        // keep water sacred: urbanisation never fills a lake
        if (this.types[i] <= T_WATER && w < 0.85) continue;
        if (w > 0.45) {
          this.types[i] = type;
          if (block) this.blocked[i] = 1;
        }
      }
    }
  }

  /**
   * Guarantee buildable dry ground around a district: water is reclaimed,
   * a small urban pad is stamped and colours are refreshed. Levels use this so
   * no district can ever spawn in the middle of a lake.
   */
  ensureLand(wx: number, wy: number, radius: number, urbanPad = true): void {
    const { cols, rows } = this;
    const cx = wx / CELL;
    const cy = wy / CELL;
    const r = Math.max(2, radius / CELL);
    const x0 = Math.max(0, Math.floor(cx - r - 1));
    const x1 = Math.min(cols - 1, Math.ceil(cx + r + 1));
    const y0 = Math.max(0, Math.floor(cy - r - 1));
    const y1 = Math.min(rows - 1, Math.ceil(cy + r + 1));
    let changed = false;
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const d = Math.hypot(x - cx, y - cy);
        if (d > r) continue;
        const i = this.idx(x, y);
        const falloff = 1 - smoothstep(d / r);
        if (this.types[i] === T_DEEP || this.types[i] === T_WATER) {
          this.types[i] = falloff > 0.55 ? T_GRASS : T_SAND;
          this.heights[i] = Math.max(this.heights[i], this.seaLevel + 0.02 + falloff * 0.06);
          changed = true;
        } else if (this.types[i] === T_ROCK && falloff > 0.6) {
          this.types[i] = T_GRASS;
          this.heights[i] *= 0.6;
          changed = true;
        }
        this.blocked[i] = 0;
      }
    }
    if (urbanPad) {
      const pr = r * 0.72;
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const d = Math.hypot(x - cx, y - cy);
          if (d > pr) continue;
          const i = this.idx(x, y);
          if (this.types[i] >= T_SAND) this.types[i] = T_URBAN;
        }
      }
      changed = true;
    }
    if (changed) this.paintCells();
  }

  private paintCells(): void {
    let hMin = Infinity;
    let hMax = -Infinity;
    for (let i = 0; i < this.heights.length; i++) {
      const h = this.heights[i];
      if (h < hMin) hMin = h;
      if (h > hMax) hMax = h;
    }
    const hRange = Math.max(0.001, hMax - hMin);
    const grain = new RNG(mixSeeds(this.seed, 'grain'));
    for (let i = 0; i < this.types.length; i++) {
      const t = this.types[i];
      const p = PALETTE[Math.min(PALETTE.length - 1, t)];
      const hn = clamp01((this.heights[i] - hMin) / hRange);
      let r = p.r;
      let g = p.g;
      let b = p.b;
      const n = (grain.next() - 0.5) * 12;
      r += n;
      g += n;
      b += n;
      if (t === T_DEEP || t === T_WATER) {
        const depth = clamp01((1 - hn) * 0.9);
        r -= depth * 8;
        g -= depth * 10;
        b += depth * 16;
      } else if (t === T_GRASS || t === T_FOREST) {
        r += hn * 12;
        g += hn * 20;
        b += hn * 8;
      } else if (t === T_ROCK) {
        r += hn * 26;
        g += hn * 25;
        b += hn * 22;
      } else if (t === T_SAND) {
        r += hn * 10;
        g += hn * 8;
      }
      this.colors[i * 3] = clamp(Math.round(r), 0, 255);
      this.colors[i * 3 + 1] = clamp(Math.round(g), 0, 255);
      this.colors[i * 3 + 2] = clamp(Math.round(b), 0, 255);
    }
  }

  // ---------------------------------------------------------------- painting

  /**
   * Render the terrain into a canvas of `w`x`h` pixels covering the world.
   * Bilinear sampling of the coarse grid + a city-block pattern for urban cells.
   */
  renderTo(
    canvas: HTMLCanvasElement,
    w: number,
    h: number,
    region?: { x0: number; y0: number; x1: number; y1: number },
  ): void {
    const fullW = Math.max(2, Math.floor(w));
    const fullH = Math.max(2, Math.floor(h));
    if (canvas.width !== fullW || canvas.height !== fullH) {
      canvas.width = fullW;
      canvas.height = fullH;
    }
    const ctx = canvas.getContext('2d', { alpha: false });
    if (!ctx) return;
    // sub-rect repaint (used when a sandbox district reclaims land)
    let ox = 0;
    let oy = 0;
    let cw = fullW;
    let ch = fullH;
    if (region) {
      ox = clamp(Math.floor((region.x0 / this.size) * fullW), 0, fullW - 1);
      oy = clamp(Math.floor((region.y0 / this.size) * fullH), 0, fullH - 1);
      cw = clamp(Math.ceil(((region.x1 - region.x0) / this.size) * fullW) + 1, 1, fullW - ox);
      ch = clamp(Math.ceil(((region.y1 - region.y0) / this.size) * fullH) + 1, 1, fullH - oy);
    }
    const img = ctx.createImageData(cw, ch);
    const data = img.data;
    const cols = this.cols;
    const rows = this.rows;
    const pxPerCellX = fullW / cols;
    const pxPerCellY = fullH / rows;
    const blockScale = 0.55; // city blocks every ~N cells
    const grainRng = new RNG(mixSeeds(this.seed, 'tex'));
    const grainTable = new Uint8Array(1024);
    for (let i = 0; i < grainTable.length; i++) grainTable[i] = Math.floor(grainRng.next() * 13) - 6;

    for (let pyi = 0; pyi < ch; pyi++) {
      const py = oy + pyi;
      const gy = (py / fullH) * rows - 0.5;
      const y0 = Math.max(0, Math.min(rows - 1, Math.floor(gy)));
      const y1 = Math.min(rows - 1, y0 + 1);
      const fy = clamp01(gy - y0);
      for (let pxi = 0; pxi < cw; pxi++) {
        const px = ox + pxi;
        const gx = (px / fullW) * cols - 0.5;
        const x0 = Math.max(0, Math.min(cols - 1, Math.floor(gx)));
        const x1 = Math.min(cols - 1, x0 + 1);
        const fx = clamp01(gx - x0);

        const i00 = this.idx(x0, y0) * 3;
        const i10 = this.idx(x1, y0) * 3;
        const i01 = this.idx(x0, y1) * 3;
        const i11 = this.idx(x1, y1) * 3;
        const w00 = (1 - fx) * (1 - fy);
        const w10 = fx * (1 - fy);
        const w01 = (1 - fx) * fy;
        const w11 = fx * fy;

        let r = this.colors[i00] * w00 + this.colors[i10] * w10 + this.colors[i01] * w01 + this.colors[i11] * w11;
        let g =
          this.colors[i00 + 1] * w00 + this.colors[i10 + 1] * w10 + this.colors[i01 + 1] * w01 + this.colors[i11 + 1] * w11;
        let b =
          this.colors[i00 + 2] * w00 + this.colors[i10 + 2] * w10 + this.colors[i01 + 2] * w01 + this.colors[i11 + 2] * w11;

        // city block texture inside urban areas
        const t00 = this.types[this.idx(x0, y0)];
        if (t00 === T_URBAN || t00 === T_BLOCK) {
          const wx = (px / pxPerCellX) * blockScale;
          const wy = (py / pxPerCellY) * blockScale;
          const grid = Math.min(Math.abs((wx % 1) - 0.5), Math.abs((wy % 1) - 0.5));
          const roadLine = grid < 0.07 ? 1 : 0;
          if (roadLine) {
            r += 26;
            g += 28;
            b += 30;
          } else {
            const shade = ((Math.floor(wx) * 7 + Math.floor(wy) * 13) % 5) * 4 - 8;
            r += shade;
            g += shade;
            b += shade + 2;
          }
        } else if (t00 === T_FOREST) {
          const wx = px * 0.35;
          const wy = py * 0.35;
          const d = Math.sin(wx) * Math.cos(wy) * 6;
          r += d;
          g += d * 1.5;
          b += d;
        } else if (t00 === T_DEEP || t00 === T_WATER) {
          const wx = px * 0.06;
          const wy = py * 0.06;
          const d = (Math.sin(wx + wy * 0.6) + Math.sin(wx * 0.5 - wy)) * 2.2;
          r += d * 0.4;
          g += d * 0.8;
          b += d * 1.4;
        }

        const gr = grainTable[((px * 73856093) ^ (py * 19349663)) & 1023] * 0.4;
        const o = (pyi * cw + pxi) * 4;
        data[o] = clamp(Math.round(r + gr), 0, 255);
        data[o + 1] = clamp(Math.round(g + gr), 0, 255);
        data[o + 2] = clamp(Math.round(b + gr), 0, 255);
        data[o + 3] = 255;
      }
    }
    ctx.putImageData(img, ox, oy);
  }
}

/** Terrain cost multiplier for building (bridge over water, clearing forest…). */
export function terrainCostMult(t: number): number {
  switch (t) {
    case T_DEEP:
    case T_WATER:
      return 2.3;
    case T_FOREST:
      return 1.35;
    case T_ROCK:
      return 1.7;
    case T_URBAN:
      return 1.2;
    case T_BLOCK:
      return 1.25;
    default:
      return 1;
  }
}

export function isWaterType(t: number): boolean {
  return t === T_DEEP || t === T_WATER;
}
