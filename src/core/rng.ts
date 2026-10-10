/**
 * Deterministic pseudo-random utilities.
 * Everything in TRAFFER that is "random" is seeded, so a level, a daily
 * challenge or a sandbox world can be reproduced exactly from its seed.
 */

/** xmur3 string hash -> 32 bit seed */
export function hashString(str: string): number {
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^= h >>> 16) >>> 0;
}

/** Combine several seeds into one, order-sensitive. */
export function mixSeeds(...parts: (number | string)[]): number {
  let h = 2166136261 >>> 0;
  for (const p of parts) {
    const s = typeof p === 'number' ? (p >>> 0).toString(36) : p;
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    h ^= 0x9e3779b9;
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32 — small, fast, good enough quality for game content. */
export class RNG {
  private s: number;
  readonly seed: number;

  constructor(seed: number | string = 1) {
    const n = typeof seed === 'number' ? seed >>> 0 : hashString(seed);
    this.seed = n >>> 0;
    this.s = (n || 0x6d2b79f5) >>> 0;
  }

  /** [0,1) */
  next(): number {
    this.s = (this.s + 0x6d2b79f5) >>> 0;
    let t = this.s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** [a,b) */
  float(a = 0, b = 1): number {
    return a + (b - a) * this.next();
  }

  /** inclusive integers */
  int(a: number, b: number): number {
    return a + Math.floor(this.next() * (b - a + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  sign(): number {
    return this.next() < 0.5 ? -1 : 1;
  }

  /** Approximate normal distribution (Irwin-Hall, n=4). */
  gaussian(mean = 0, sd = 1): number {
    const u = (this.next() + this.next() + this.next() + this.next() - 2) / 2;
    return mean + u * sd * 1.7;
  }

  pick<T>(arr: readonly T[]): T {
    return arr[Math.min(arr.length - 1, Math.floor(this.next() * arr.length))];
  }

  pickWeighted<T>(arr: readonly T[], weight: (item: T) => number): T {
    let total = 0;
    for (const it of arr) total += Math.max(0, weight(it));
    if (total <= 0) return this.pick(arr);
    let r = this.next() * total;
    for (const it of arr) {
      r -= Math.max(0, weight(it));
      if (r <= 0) return it;
    }
    return arr[arr.length - 1];
  }

  shuffle<T>(arr: T[]): T[] {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = arr[i];
      arr[i] = arr[j];
      arr[j] = t;
    }
    return arr;
  }

  /** Fork a child generator without disturbing this one's stream. */
  fork(tag: number | string = 0): RNG {
    return new RNG(mixSeeds(this.seed, tag, Math.floor(this.next() * 0xffffffff)));
  }
}

/** 2D value noise with fbm, built from a permutation table. */
export class Noise2D {
  private perm: Uint8Array;

  constructor(rng: RNG) {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    this.perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) this.perm[i] = p[i & 255];
  }

  private grad(hash: number): number {
    // value noise: hash -> [-1,1]
    return (hash / 255) * 2 - 1;
  }

  private fade(t: number): number {
    return t * t * t * (t * (t * 6 - 15) + 10);
  }

  /** returns roughly [-1,1] */
  at(x: number, y: number): number {
    const xi = Math.floor(x);
    const yi = Math.floor(y);
    const xf = x - xi;
    const yf = y - yi;
    const X = xi & 255;
    const Y = yi & 255;
    const p = this.perm;
    const aa = p[p[X] + Y];
    const ab = p[p[X] + Y + 1];
    const ba = p[p[X + 1] + Y];
    const bb = p[p[X + 1] + Y + 1];
    const u = this.fade(xf);
    const v = this.fade(yf);
    const x1 = this.grad(aa) + u * (this.grad(ba) - this.grad(aa));
    const x2 = this.grad(ab) + u * (this.grad(bb) - this.grad(ab));
    return x1 + v * (x2 - x1);
  }

  /** fractal brownian motion, returns roughly [-1,1] */
  fbm(x: number, y: number, octaves = 4, lacunarity = 2.02, gain = 0.5): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      sum += amp * this.at(x * freq, y * freq);
      norm += amp;
      amp *= gain;
      freq *= lacunarity;
    }
    return sum / (norm || 1);
  }

  /** ridged noise — good for mountain chains */
  ridged(x: number, y: number, octaves = 4): number {
    let amp = 1;
    let freq = 1;
    let sum = 0;
    let norm = 0;
    for (let o = 0; o < octaves; o++) {
      const n = 1 - Math.abs(this.at(x * freq, y * freq));
      sum += amp * n * n;
      norm += amp;
      amp *= 0.5;
      freq *= 2.03;
    }
    return (sum / (norm || 1)) * 2 - 1;
  }
}
