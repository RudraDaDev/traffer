/** Small 2D geometry / math toolbox. No dependencies, allocation-light. */

export interface Vec2 {
  x: number;
  y: number;
}

export const TAU = Math.PI * 2;
export const EPS = 1e-9;

export const v = (x: number, y: number): Vec2 => ({ x, y });
export const clone = (a: Vec2): Vec2 => ({ x: a.x, y: a.y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2): number => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2): number => a.x * b.y - a.y * b.x;
export const len = (a: Vec2): number => Math.hypot(a.x, a.y);
export const len2 = (a: Vec2): number => a.x * a.x + a.y * a.y;
export const dist = (a: Vec2, b: Vec2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const dist2 = (a: Vec2, b: Vec2): number => {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
};
export const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
export const lerpV = (a: Vec2, b: Vec2, t: number): Vec2 => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
export const clamp = (x: number, lo: number, hi: number): number => (x < lo ? lo : x > hi ? hi : x);
export const clamp01 = (x: number): number => (x < 0 ? 0 : x > 1 ? 1 : x);
export const smoothstep = (t: number): number => {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
};
export const sign = (x: number): number => (x < 0 ? -1 : 1);

export function norm(a: Vec2): Vec2 {
  const l = Math.hypot(a.x, a.y);
  return l < EPS ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
}

export function angleOf(a: Vec2): number {
  return Math.atan2(a.y, a.x);
}

export function fromAngle(a: number, l = 1): Vec2 {
  return { x: Math.cos(a) * l, y: Math.sin(a) * l };
}

export function angleDiff(a: number, b: number): number {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

/** Snap an angle to the nearest multiple of `step` if within `tolerance`. */
export function snapAngle(a: number, step: number, tolerance: number): number {
  const k = Math.round(a / step);
  const snapped = k * step;
  return Math.abs(angleDiff(a, snapped)) <= tolerance ? snapped : a;
}

export interface Projection {
  /** parameter along segment [0,1] */
  t: number;
  /** arc distance from a */
  d: number;
  point: Vec2;
  dist: number;
}

/** Closest point on segment ab to p. */
export function projectOnSegment(p: Vec2, a: Vec2, b: Vec2): Projection {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  let t = l2 < EPS ? 0 : ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2;
  t = clamp01(t);
  const point = { x: a.x + abx * t, y: a.y + aby * t };
  return { t, d: t * Math.sqrt(l2), point, dist: Math.hypot(p.x - point.x, p.y - point.y) };
}

/** Proper segment/segment intersection point, or null. */
export function segmentIntersection(a: Vec2, b: Vec2, c: Vec2, d: Vec2): Vec2 | null {
  const r = { x: b.x - a.x, y: b.y - a.y };
  const s = { x: d.x - c.x, y: d.y - c.y };
  const denom = cross(r, s);
  if (Math.abs(denom) < 1e-7) return null; // parallel / collinear
  const ac = { x: c.x - a.x, y: c.y - a.y };
  const t = cross(ac, s) / denom;
  const u = cross(ac, r) / denom;
  if (t < -1e-6 || t > 1 + 1e-6 || u < -1e-6 || u > 1 + 1e-6) return null;
  return { x: a.x + r.x * clamp01(t), y: a.y + r.y * clamp01(t) };
}

export function polylineLength(pts: readonly Vec2[]): number {
  let total = 0;
  for (let i = 1; i < pts.length; i++) total += dist(pts[i - 1], pts[i]);
  return total;
}

/** cumulative arc lengths, same length as pts */
export function cumulative(pts: readonly Vec2[]): number[] {
  const out = new Array<number>(pts.length);
  out[0] = 0;
  for (let i = 1; i < pts.length; i++) out[i] = out[i - 1] + dist(pts[i - 1], pts[i]);
  return out;
}

/** Point + heading at arc-length `t` along a polyline described by pts/cum. */
export function pointAt(pts: readonly Vec2[], cum: readonly number[], t: number): { p: Vec2; a: number } {
  const total = cum[cum.length - 1] || 0;
  const tt = clamp(t, 0, total);
  // binary search for the segment
  let lo = 0;
  let hi = cum.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= tt) lo = mid;
    else hi = mid;
  }
  const segLen = cum[hi] - cum[lo];
  const f = segLen < EPS ? 0 : (tt - cum[lo]) / segLen;
  const a = pts[lo];
  const b = pts[hi];
  return { p: { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f) }, a: Math.atan2(b.y - a.y, b.x - a.x) };
}

/** Ramer-Douglas-Peucker simplification. */
export function simplify(pts: readonly Vec2[], tolerance: number): Vec2[] {
  if (pts.length < 3) return pts.map(clone);
  const keep = new Uint8Array(pts.length);
  keep[0] = 1;
  keep[pts.length - 1] = 1;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [s, e] = stack.pop()!;
    let maxD = -1;
    let idx = -1;
    for (let i = s + 1; i < e; i++) {
      const d = projectOnSegment(pts[i], pts[s], pts[e]).dist;
      if (d > maxD) {
        maxD = d;
        idx = i;
      }
    }
    if (maxD > tolerance && idx > 0) {
      keep[idx] = 1;
      stack.push([s, idx], [idx, e]);
    }
  }
  const out: Vec2[] = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(clone(pts[i]));
  return out;
}

/** Remove consecutive duplicates within `eps`. */
export function dedupe(pts: readonly Vec2[], eps = 0.01): Vec2[] {
  const out: Vec2[] = [];
  for (const p of pts) {
    if (!out.length || dist2(out[out.length - 1], p) > eps * eps) out.push(clone(p));
  }
  return out;
}

/**
 * Chaikin corner-cutting. Endpoints are preserved so roads still meet their
 * junctions exactly. `iterations` of 1-2 is plenty for road geometry.
 */
export function smoothPolyline(pts: readonly Vec2[], iterations = 2, minSeg = 6): Vec2[] {
  let cur = dedupe(pts, 0.05);
  if (cur.length < 3) return cur;
  for (let it = 0; it < iterations; it++) {
    const next: Vec2[] = [clone(cur[0])];
    for (let i = 0; i < cur.length - 1; i++) {
      const a = cur[i];
      const b = cur[i + 1];
      const segLen = dist(a, b);
      if (segLen < minSeg) {
        next.push(clone(b));
        continue;
      }
      next.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      next.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    next[next.length - 1] = clone(cur[cur.length - 1]);
    cur = dedupe(next, 0.05);
  }
  return cur;
}

/** Insert `p` into a polyline, splitting the nearest segment. */
export function insertPointIntoPolyline(pts: readonly Vec2[], p: Vec2): Vec2[] {
  if (pts.length < 2) return [...pts.map(clone), clone(p)];
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const pr = projectOnSegment(p, pts[i], pts[i + 1]);
    if (pr.dist < bestD) {
      bestD = pr.dist;
      best = i;
    }
  }
  const out = pts.slice(0, best + 1).map(clone);
  out.push(clone(p));
  for (let i = best + 1; i < pts.length; i++) out.push(clone(pts[i]));
  return dedupe(out, 0.01);
}

/**
 * Tidy a polyline: any segment whose heading is close to a multiple of `step`
 * is rotated onto it exactly, keeping its length. Anchored at the first point.
 */
export function snapPolylineAngles(pts: readonly Vec2[], step: number, tolerance: number): Vec2[] {
  if (pts.length < 2) return pts.map(clone);
  const out: Vec2[] = [clone(pts[0])];
  for (let i = 1; i < pts.length; i++) {
    const prev = out[i - 1];
    const cur = pts[i];
    const dx = cur.x - prev.x;
    const dy = cur.y - prev.y;
    const l = Math.hypot(dx, dy);
    if (l < 1e-6) {
      out.push(clone(cur));
      continue;
    }
    const a = snapAngle(Math.atan2(dy, dx), step, tolerance);
    out.push({ x: prev.x + Math.cos(a) * l, y: prev.y + Math.sin(a) * l });
  }
  return out;
}

export function polygonArea(pts: readonly Vec2[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a) / 2;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function rectFromPoints(a: Vec2, b: Vec2): Rect {
  return {
    x: Math.min(a.x, b.x),
    y: Math.min(a.y, b.y),
    w: Math.abs(a.x - b.x),
    h: Math.abs(a.y - b.y),
  };
}

export function rectContains(r: Rect, p: Vec2): boolean {
  return p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h;
}

/** Segment vs rect (Liang-Barsky) — used to cull roads/cars off screen. */
export function segmentIntersectsRect(a: Vec2, b: Vec2, r: Rect): boolean {
  if (rectContains(r, a) || rectContains(r, b)) return true;
  const x0 = r.x;
  const y0 = r.y;
  const x1 = r.x + r.w;
  const y1 = r.y + r.h;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  let t0 = 0;
  let t1 = 1;
  const check = (p: number, q: number): boolean => {
    if (Math.abs(p) < EPS) return q >= 0;
    const rt = q / p;
    if (p < 0) {
      if (rt > t1) return false;
      if (rt > t0) t0 = rt;
    } else {
      if (rt < t0) return false;
      if (rt < t1) t1 = rt;
    }
    return true;
  };
  return check(-dx, a.x - x0) && check(dx, x1 - a.x) && check(-dy, a.y - y0) && check(dy, y1 - a.y);
}

export function formatNumber(n: number): string {
  if (!isFinite(n)) return '0';
  const a = Math.abs(n);
  if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
  if (a >= 1e4) return (n / 1e3).toFixed(0) + 'k';
  if (a >= 1000) return n.toFixed(0).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return Math.round(n).toString();
}

export function formatMoney(n: number): string {
  const s = n < 0 ? '-' : '';
  const a = Math.abs(Math.round(n));
  return s + '$' + a.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatTime(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const m = Math.floor(s / 60);
  return `${m}:${(s % 60).toString().padStart(2, '0')}`;
}

export function roundTo(n: number, step: number): number {
  return Math.round(n / step) * step;
}

/** Exponential approach that is frame-rate independent. */
export function approach(current: number, target: number, rate: number, dt: number): number {
  return current + (target - current) * (1 - Math.exp(-rate * dt));
}

export function easeOutCubic(t: number): number {
  const x = clamp01(t);
  return 1 - Math.pow(1 - x, 3);
}

export function easeInOutCubic(t: number): number {
  const x = clamp01(t);
  return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;
}

export function easeOutBack(t: number): number {
  const c1 = 1.70158;
  const c3 = c1 + 1;
  const x = clamp01(t);
  return 1 + c3 * Math.pow(x - 1, 3) + c1 * Math.pow(x - 1, 2);
}
