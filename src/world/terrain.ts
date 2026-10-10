/**
 * City fabric.
 *
 * The playable area is one neighbourhood, not a world map. Land is a block
 * grid (streets, roofs, parks, works yards). Water only appears where a level
 * asks for a canal, a pond or a waterfront — never as an ocean ringing an
 * island. Types live on a coarse grid (one cell = CELL world units).
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
    const seaFrac = clamp01(spec.sea ?? 0);
    const forestAmt = spec.forest ?? 0.14;
    const rockAmt = spec.rock ?? 0;
    // 'none' unless a level explicitly wants an island. A soft edge used to
    // sink the border into the sea and the whole neighbourhood read as a continent.
    const border = spec.border ?? 'none';
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
          const falloff = smoothstep(edge / 0.18);
          h = h * (0.9 + 0.1 * falloff) - (1 - falloff) * 0.08;
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
      const rad = rng.float(0.035, 0.07) * cols;
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

    // 4. classify as a neighbourhood, not a continent ------------------------
    // Parks are a capped slice of the block grid. Works yards are a few lots,
    // not a mountain range. Water is only canals, ponds and a waterfront.
    const parkNoise = new Float32Array(cols * rows);
    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        parkNoise[this.idx(cx, cy)] = this.noise2.fbm((cx / cols) * 5.5 + 4, (cy / rows) * 5.5 - 2, 3);
      }
    }
    const parkSorted = Float32Array.from(parkNoise).sort();
    const parkFrac = clamp(forestAmt * 0.34, 0, 0.2);
    const parkCut = parkSorted[clamp(Math.floor((1 - parkFrac) * (parkSorted.length - 1)), 0, parkSorted.length - 1)];
    const harbor = !!(spec.coast && spec.coast !== 'none');
    void range;
    void sandLevel;
    void rockLevel;
    void seaLevel;
    void deepLevel;

    for (let cy = 0; cy < rows; cy++) {
      for (let cx = 0; cx < cols; cx++) {
        const i = this.idx(cx, cy);
        const riv = riverField ? riverField[i] : 0;
        const lake = lakeField[i];
        const coastT = harbor ? this.coastFalloff(cx / cols, cy / rows, spec.coast!) : 0;
        let t = T_URBAN;
        if (riv > 0.08 || lake > 0.22) t = T_DEEP;
        else if (riv > 0.03 || lake > 0.1) t = T_WATER;
        else if (coastT > 0.55 && seaFrac > 0) t = coastT > 0.82 ? T_DEEP : T_WATER;
        else if (parkNoise[i] > parkCut) t = parkNoise[i] > parkCut + 0.08 ? T_FOREST : T_GRASS;
        this.types[i] = t;
        if (t <= T_WATER) this.heights[i] = Math.min(this.heights[i], this.seaLevel);
      }
    }

    // snap parks onto whole blocks so they read as parks, not continental blobs
    const BC = 14;
    for (let by = 0; by < rows; by += BC) {
      for (let bx = 0; bx < cols; bx += BC) {
        let park = 0;
        let water = 0;
        let n = 0;
        const x1 = Math.min(cols, bx + BC);
        const y1 = Math.min(rows, by + BC);
        for (let y = by + 2; y < y1 - 1; y++) {
          for (let x = bx + 2; x < x1 - 1; x++) {
            const t = this.types[this.idx(x, y)];
            n++;
            if (t === T_GRASS || t === T_FOREST) park++;
            if (t <= T_WATER) water++;
          }
        }
        if (!n || water > n * 0.25) continue;
        const makePark = park > n * 0.42;
        for (let y = by; y < y1; y++) {
          for (let x = bx; x < x1; x++) {
            const i = this.idx(x, y);
            const edge = x < bx + 2 || y < by + 2 || x >= x1 - 1 || y >= y1 - 1;
            if (this.types[i] <= T_WATER || this.types[i] === T_BLOCK) continue;
            if (!makePark) {
              if (this.types[i] === T_GRASS || this.types[i] === T_FOREST) this.types[i] = T_URBAN;
            } else if (!edge) {
              this.types[i] = park > n * 0.7 ? T_FOREST : T_GRASS;
            }
          }
        }
      }
    }

    // industrial lots — local yards you pay extra to pave, not grey continents
    const lots = Math.round(clamp01(rockAmt) * 6);
    for (let n = 0; n < lots; n++) {
      const lx = rng.float(0.12, 0.88);
      const ly = rng.float(0.12, 0.88);
      this.stampCircle(lx * cols, ly * rows, rng.float(0.035, 0.07) * cols, T_ROCK, false);
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
    const BLOCK = 56;
    const STREET = 11;

    for (let pyi = 0; pyi < ch; pyi++) {
      const py = oy + pyi;
      const wy = ((py + 0.5) / fullH) * this.size;
      const gy = (py / fullH) * rows - 0.5;
      const y0 = Math.max(0, Math.min(rows - 1, Math.floor(gy)));
      for (let pxi = 0; pxi < cw; pxi++) {
        const px = ox + pxi;
        const wx = ((px + 0.5) / fullW) * this.size;
        const gx = (px / fullW) * cols - 0.5;
        const x0 = Math.max(0, Math.min(cols - 1, Math.floor(gx)));
        const local = this.types[this.idx(x0, y0)];
        const bx0 = Math.floor(wx / BLOCK);
        const by0 = Math.floor(wy / BLOCK);
        const lx0 = wx - bx0 * BLOCK;
        const ly0 = wy - by0 * BLOCK;
        const onStreet = lx0 < STREET || ly0 < STREET;
        const center = this.typeAt((bx0 + 0.5) * BLOCK, (by0 + 0.5) * BLOCK);
        const t = local <= T_WATER || local === T_BLOCK ? local : onStreet ? T_URBAN : center;

        let r = 74;
        let g = 78;
        let b = 82;
        if (t === T_DEEP || t === T_WATER) {
          const deep = t === T_DEEP;
          r = deep ? 14 : 26;
          g = deep ? 78 : 112;
          b = deep ? 118 : 148;
          const ripple = Math.sin(wx * 0.08 + wy * 0.05) * 4;
          g += ripple;
          b += ripple * 0.6;
        } else if (t === T_GRASS || t === T_FOREST) {
          r = 86;
          g = 138;
          b = 78;
          const tx = Math.floor(wx / 16);
          const ty = Math.floor(wy / 16);
          const trunk = ((tx * 17 + ty * 11) % 5) === 0;
          if (trunk) {
            const lx = wx - tx * 16 - 8;
            const ly = wy - ty * 16 - 8;
            if (lx * lx + ly * ly < 22) {
              r = 36;
              g = 92;
              b = 48;
            }
          }
          if (t === T_FOREST) {
            r -= 12;
            g -= 16;
          }
        } else if (t === T_BLOCK) {
          r = 52;
          g = 56;
          b = 62;
          const hatch = Math.floor(wx + wy) % 11 === 0;
          if (hatch) {
            r += 18;
            g += 16;
            b += 12;
          }
        } else {
          const bx = Math.floor(wx / BLOCK);
          const by = Math.floor(wy / BLOCK);
          const lx = wx - bx * BLOCK;
          const ly = wy - by * BLOCK;
          const hsh = Math.abs((bx * 73856093) ^ (by * 19349663));
          if ((lx < STREET || ly < STREET) && t !== T_ROCK) {
            const curb = lx < 1.6 || ly < 1.6;
            r = curb ? 168 : 62;
            g = curb ? 164 : 68;
            b = curb ? 148 : 74;
          } else if (lx < STREET + 3.2 || ly < STREET + 3.2) {
            r = 176;
            g = 168;
            b = 150;
          } else {
            const palette =
              t === T_ROCK
                ? [
                    [98, 100, 104],
                    [82, 84, 88],
                    [114, 110, 102],
                  ]
                : [
                    [186, 142, 108],
                    [154, 132, 114],
                    [196, 164, 128],
                    [122, 136, 150],
                    [168, 118, 98],
                    [210, 186, 150],
                  ];
            const col = palette[hsh % palette.length];
            r = col[0];
            g = col[1];
            b = col[2];
            const roofL = STREET + 4.5;
            const roofT = STREET + 4.5;
            const roofR = BLOCK - 3.2;
            const roofB = BLOCK - 3.2;
            if (lx < roofL || ly < roofT || lx > roofR || ly > roofB) {
              r -= 34;
              g -= 30;
              b -= 24;
            } else {
              const colsN = 2 + (hsh % 2);
              const rowsN = 2 + ((hsh >> 2) % 2);
              const cw = (roofR - roofL) / colsN;
              const chh = (roofB - roofT) / rowsN;
              const cx = (lx - roofL) % cw;
              const cy = (ly - roofT) % chh;
              if (cx > cw * 0.3 && cx < cw * 0.7 && cy > chh * 0.28 && cy < chh * 0.62) {
                r = Math.max(20, r - 70);
                g = Math.max(20, g - 58);
                b = Math.max(16, b - 40);
              }
            }
          }
        }

        if (wx < 2 || wy < 2 || wx > this.size - 2 || wy > this.size - 2) {
          r = 176;
          g = 168;
          b = 150;
        }
        const o = (pyi * cw + pxi) * 4;
        data[o] = clamp(Math.round(r), 0, 255);
        data[o + 1] = clamp(Math.round(g), 0, 255);
        data[o + 2] = clamp(Math.round(b), 0, 255);
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
      return 1;
    case T_BLOCK:
      return 1.25;
    default:
      return 1;
  }
}

export function isWaterType(t: number): boolean {
  return t === T_DEEP || t === T_WATER;
}
