/**
 * The road network.
 *
 * Nodes are junctions / endpoints, edges are polyline road segments between two
 * nodes. This module owns all structural editing: drawing a road, snapping it
 * onto existing geometry, creating junctions where roads cross, grade
 * separation for freeways, bulldozing and undo snapshots.
 *
 * Arc-length convention: `car.t` is always measured from node **a** along the
 * edge polyline, whatever the travel direction. dir = +1 travels a->b (t grows),
 * dir = -1 travels b->a (t shrinks).
 */

import { BUILD, ECONOMY, ROADS, CAR_SPACING, type RoadKind } from '../game/config';
import {
  clamp,
  clamp01,
  cumulative,
  dedupe,
  dist,
  dist2,
  polylineLength,
  projectOnSegment,
  roundTo,
  segmentIntersection,
  simplify,
  smoothPolyline,
  snapPolylineAngles,
  type Vec2,
} from '../core/math';
import { CELL, type Terrain } from '../world/terrain';
import type { Car } from '../sim/car';

export type NodeKind = 'junction' | 'end' | 'zone';

export interface RNode {
  id: number;
  x: number;
  y: number;
  edges: number[];
  kind: NodeKind;
  zoneId: number | null;
  /** sim: how contested this junction is right now (0..1) */
  pressure: number;
  /** sim: vehicles passing per second */
  flow: number;
  /** render: pulse timer when a road connects here */
  pulse: number;
}

export interface Edge {
  id: number;
  a: number;
  b: number;
  kind: RoadKind;
  pts: Vec2[];
  cum: number[];
  len: number;
  bridge: boolean;
  cost: number;
  /** 0..1 paving animation */
  buildT: number;
  lanesPerDir: number;
  freeSpeed: number;
  /** jam capacity (vehicles) */
  cap: number;
  /** arc-lengths where this freeway flies over surface roads */
  viaduct: number[];
  // ---- simulation state
  carsF: Car[];
  carsB: Car[];
  density: number;
  congestion: number;
  avgSpeed: number;
  flow: number;
  builtLen: number;
}

export type BuildReason = 'ok' | 'too-short' | 'no-bridge' | 'no-funds' | 'no-tool' | 'duplicate';

export interface BuildResult {
  ok: boolean;
  reason: BuildReason;
  message?: string;
  edges: Edge[];
  cost: number;
  /** credited back when the new road replaces an older, narrower one */
  refund: number;
  length: number;
  bridges: number;
  partial: boolean;
  /** edges removed because the new road upgraded them */
  replaced: number[];
}

export interface Snapshot {
  nodes: { id: number; x: number; y: number; kind: NodeKind; zoneId: number | null }[];
  edges: { id: number; a: number; b: number; kind: RoadKind; pts: [number, number][]; bridge: boolean; cost: number }[];
  nextNodeId: number;
  nextEdgeId: number;
}

interface Attach {
  /** arc length along the new path */
  s: number;
  p: Vec2;
  node?: RNode;
  edge?: Edge;
  /** 2 = existing node, 1.5 = endpoint crossing, 1 = crossing, 0 = free end */
  priority: number;
}

const fail = (reason: BuildReason, message?: string): BuildResult => ({
  ok: false,
  reason,
  message,
  edges: [],
  cost: 0,
  refund: 0,
  length: 0,
  bridges: 0,
  partial: false,
  replaced: [],
});

export class Network {
  terrain: Terrain;
  size: number;
  nodes: RNode[] = [];
  edges: Edge[] = [];
  private nodeById = new Map<number, RNode>();
  private edgeById = new Map<number, Edge>();
  private nextNodeId = 1;
  private nextEdgeId = 1;
  private indexDirty = true;
  private buckets = new Map<number, { n: number[]; e: number[] }>();
  private bucketCols = 1;
  private readonly bucketSize = 96;

  constructor(terrain: Terrain, size: number) {
    this.terrain = terrain;
    this.size = size;
  }

  // ------------------------------------------------------------------ basics

  clear(): void {
    this.nodes = [];
    this.edges = [];
    this.nodeById.clear();
    this.edgeById.clear();
    this.nextNodeId = 1;
    this.nextEdgeId = 1;
    this.indexDirty = true;
  }

  getNode(id: number): RNode | undefined {
    return this.nodeById.get(id);
  }

  getEdge(id: number): Edge | undefined {
    return this.edgeById.get(id);
  }

  addNode(x: number, y: number, kind: NodeKind = 'end', zoneId: number | null = null): RNode {
    const n: RNode = { id: this.nextNodeId++, x, y, edges: [], kind, zoneId, pressure: 0, flow: 0, pulse: 0 };
    this.nodes.push(n);
    this.nodeById.set(n.id, n);
    this.indexDirty = true;
    return n;
  }

  addEdge(a: RNode, b: RNode, pts: Vec2[], kind: RoadKind, cost = 0): Edge {
    const list = dedupe(pts, 0.35);
    if (list.length < 2) {
      list.length = 0;
      list.push({ x: a.x, y: a.y }, { x: b.x, y: b.y });
    }
    const cum = cumulative(list);
    const len = Math.max(0.001, cum[cum.length - 1]);
    const spec = ROADS[kind];
    const e: Edge = {
      id: this.nextEdgeId++,
      a: a.id,
      b: b.id,
      kind,
      pts: list,
      cum,
      len,
      bridge: false,
      cost,
      buildT: 1,
      lanesPerDir: Math.max(1, spec.lanes / 2),
      freeSpeed: spec.speed,
      cap: Math.max(2, Math.floor(len / CAR_SPACING) * spec.lanes),
      viaduct: [],
      carsF: [],
      carsB: [],
      density: 0,
      congestion: 0,
      avgSpeed: spec.speed,
      flow: 0,
      builtLen: len,
    };
    a.edges.push(e.id);
    b.edges.push(e.id);
    if (a.edges.length > 1) a.kind = 'junction';
    if (b.edges.length > 1) b.kind = 'junction';
    this.edges.push(e);
    this.edgeById.set(e.id, e);
    this.indexDirty = true;
    return e;
  }

  removeEdge(id: number): Edge | null {
    const e = this.edgeById.get(id);
    if (!e) return null;
    this.edgeById.delete(id);
    const i = this.edges.indexOf(e);
    if (i >= 0) this.edges.splice(i, 1);
    for (const nid of [e.a, e.b]) {
      const n = this.nodeById.get(nid);
      if (!n) continue;
      const k = n.edges.indexOf(id);
      if (k >= 0) n.edges.splice(k, 1);
      if (n.edges.length <= 1 && n.kind === 'junction') n.kind = 'end';
    }
    this.indexDirty = true;
    return e;
  }

  removeNode(id: number): void {
    const n = this.nodeById.get(id);
    if (!n) return;
    for (const eid of [...n.edges]) this.removeEdge(eid);
    this.nodeById.delete(id);
    const i = this.nodes.indexOf(n);
    if (i >= 0) this.nodes.splice(i, 1);
    this.indexDirty = true;
  }

  /** Delete nodes that no longer carry any road (zone anchors are kept). */
  pruneOrphans(): void {
    for (const n of [...this.nodes]) {
      if (n.edges.length === 0 && n.zoneId === null) this.removeNode(n.id);
    }
  }

  otherEnd(e: Edge, nodeId: number): number {
    return e.a === nodeId ? e.b : e.a;
  }

  // -------------------------------------------------------------- spatial idx

  private rebuildIndex(): void {
    this.buckets.clear();
    this.bucketCols = Math.max(1, Math.ceil(this.size / this.bucketSize));
    const key = (x: number, y: number) => {
      const cx = clamp(Math.floor(x / this.bucketSize), 0, this.bucketCols - 1);
      const cy = clamp(Math.floor(y / this.bucketSize), 0, this.bucketCols - 1);
      return cy * this.bucketCols + cx;
    };
    const get = (k: number) => {
      let b = this.buckets.get(k);
      if (!b) {
        b = { n: [], e: [] };
        this.buckets.set(k, b);
      }
      return b;
    };
    for (const n of this.nodes) get(key(n.x, n.y)).n.push(n.id);
    for (const e of this.edges) {
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const p of e.pts) {
        if (p.x < x0) x0 = p.x;
        if (p.y < y0) y0 = p.y;
        if (p.x > x1) x1 = p.x;
        if (p.y > y1) y1 = p.y;
      }
      const cx0 = clamp(Math.floor(x0 / this.bucketSize), 0, this.bucketCols - 1);
      const cx1 = clamp(Math.floor(x1 / this.bucketSize), 0, this.bucketCols - 1);
      const cy0 = clamp(Math.floor(y0 / this.bucketSize), 0, this.bucketCols - 1);
      const cy1 = clamp(Math.floor(y1 / this.bucketSize), 0, this.bucketCols - 1);
      for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) get(cy * this.bucketCols + cx).e.push(e.id);
    }
    this.indexDirty = false;
  }

  private query(x: number, y: number, r: number): { nodes: RNode[]; edges: Edge[] } {
    if (this.indexDirty) this.rebuildIndex();
    const nodeSet = new Set<number>();
    const edgeSet = new Set<number>();
    const cx0 = clamp(Math.floor((x - r) / this.bucketSize), 0, this.bucketCols - 1);
    const cx1 = clamp(Math.floor((x + r) / this.bucketSize), 0, this.bucketCols - 1);
    const cy0 = clamp(Math.floor((y - r) / this.bucketSize), 0, this.bucketCols - 1);
    const cy1 = clamp(Math.floor((y + r) / this.bucketSize), 0, this.bucketCols - 1);
    for (let cy = cy0; cy <= cy1; cy++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        const b = this.buckets.get(cy * this.bucketCols + cx);
        if (!b) continue;
        for (const id of b.n) nodeSet.add(id);
        for (const id of b.e) edgeSet.add(id);
      }
    }
    const nodes: RNode[] = [];
    for (const id of nodeSet) {
      const n = this.nodeById.get(id);
      if (n) nodes.push(n);
    }
    const edges: Edge[] = [];
    for (const id of edgeSet) {
      const e = this.edgeById.get(id);
      if (e) edges.push(e);
    }
    return { nodes, edges };
  }

  /** Whole-network query used only when the stroke bbox is big. */
  private queryBox(x0: number, y0: number, x1: number, y1: number): { nodes: RNode[]; edges: Edge[] } {
    const cx = (x0 + x1) / 2;
    const cy = (y0 + y1) / 2;
    const r = Math.hypot(x1 - x0, y1 - y0) / 2 + 32;
    return this.query(cx, cy, Math.min(r, this.size * 1.5));
  }

  nearestNode(x: number, y: number, maxDist: number): RNode | null {
    const { nodes } = this.query(x, y, maxDist);
    let best: RNode | null = null;
    let bd = maxDist * maxDist;
    for (const n of nodes) {
      const d = dist2(n, { x, y });
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }

  nearestEdgePoint(
    x: number,
    y: number,
    maxDist: number,
  ): { edge: Edge; point: Vec2; dist: number; tAlong: number } | null {
    const { edges } = this.query(x, y, maxDist);
    const p = { x, y };
    let best: { edge: Edge; point: Vec2; dist: number; tAlong: number } | null = null;
    for (const e of edges) {
      for (let i = 0; i < e.pts.length - 1; i++) {
        const pr = projectOnSegment(p, e.pts[i], e.pts[i + 1]);
        if (pr.dist <= maxDist && (!best || pr.dist < best.dist)) {
          best = { edge: e, point: pr.point, dist: pr.dist, tAlong: e.cum[i] + pr.d };
        }
      }
    }
    return best;
  }

  nearestNodeAnywhere(x: number, y: number, maxDist: number): RNode | null {
    let best: RNode | null = null;
    let bd = maxDist * maxDist;
    for (const n of this.nodes) {
      const d = dist2(n, { x, y });
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    return best;
  }

  // ------------------------------------------------------------------ split

  /**
   * Insert a node into an edge at `p`, splitting it in two. The original keeps
   * its id (so car paths stay valid); the tail half gets a fresh id.
   */
  splitEdge(e: Edge, p: Vec2): RNode {
    let bestI = 0;
    let bestD = Infinity;
    let bestPoint = p;
    let bestArc = 0;
    for (let i = 0; i < e.pts.length - 1; i++) {
      const pr = projectOnSegment(p, e.pts[i], e.pts[i + 1]);
      if (pr.dist < bestD) {
        bestD = pr.dist;
        bestI = i;
        bestPoint = pr.point;
        bestArc = e.cum[i] + pr.d;
      }
    }
    const na = this.nodeById.get(e.a)!;
    const nb = this.nodeById.get(e.b)!;
    if (!na || !nb) return this.addNode(bestPoint.x, bestPoint.y, 'junction');
    if (bestArc < 5) return na;
    if (e.len - bestArc < 5) return nb;

    const headPts = dedupe([...e.pts.slice(0, bestI + 1), { ...bestPoint }], 0.2);
    const tailPts = dedupe([{ ...bestPoint }, ...e.pts.slice(bestI + 1)], 0.2);
    const mid = this.addNode(bestPoint.x, bestPoint.y, 'junction');
    const tail = this.copyEdge(e, mid, nb, tailPts);

    // detach the old b from the head edge
    const ki = nb.edges.indexOf(e.id);
    if (ki >= 0) nb.edges.splice(ki, 1);
    e.b = mid.id;
    mid.edges.push(e.id);
    e.pts = headPts;
    e.cum = cumulative(headPts);
    e.len = Math.max(0.001, e.cum[e.cum.length - 1]);
    e.cap = Math.max(2, Math.floor(e.len / CAR_SPACING) * ROADS[e.kind].lanes);
    e.viaduct = e.viaduct.filter((t) => t <= e.len);
    e.builtLen = e.len * e.buildT;

    const splitT = bestArc;
    for (const list of [e.carsF, e.carsB]) {
      const dest = list === e.carsF ? tail.carsF : tail.carsB;
      for (let i = list.length - 1; i >= 0; i--) {
        const car = list[i];
        if (car.t < splitT) continue;
        list.splice(i, 1);
        car.edge = tail;
        car.t = clamp(car.t - splitT, 0, tail.len);
        dest.push(car);
      }
      dest.sort((p1, p2) => p1.t - p2.t);
    }
    this.indexDirty = true;
    return mid;
  }

  private copyEdge(src: Edge, a: RNode, b: RNode, pts: Vec2[]): Edge {
    const cum = cumulative(pts);
    const len = Math.max(0.001, cum[cum.length - 1]);
    const e: Edge = {
      id: this.nextEdgeId++,
      a: a.id,
      b: b.id,
      kind: src.kind,
      pts,
      cum,
      len,
      bridge: src.bridge,
      cost: src.cost * (len / Math.max(1, src.len)),
      buildT: src.buildT,
      lanesPerDir: src.lanesPerDir,
      freeSpeed: src.freeSpeed,
      cap: Math.max(2, Math.floor(len / CAR_SPACING) * ROADS[src.kind].lanes),
      viaduct: [],
      carsF: [],
      carsB: [],
      density: 0,
      congestion: 0,
      avgSpeed: src.avgSpeed,
      flow: 0,
      builtLen: len * src.buildT,
    };
    a.edges.push(e.id);
    b.edges.push(e.id);
    this.edges.push(e);
    this.edgeById.set(e.id, e);
    return e;
  }

  // ------------------------------------------------------------------ upgrade

  /**
   * Which existing roads does this stroke replace? Drawing a wider road over a
   * narrower one upgrades it in place (partially refunded) instead of stacking
   * two roads on the same ground. Freeways are grade separated, so they never
   * consume the surface road beneath them.
   */
  findUpgradable(pts: readonly Vec2[], kind: RoadKind): Edge[] {
    const spec = ROADS[kind];
    if (spec.gradeSeparated) return [];
    const tol = spec.width * 0.85 + 5;
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of pts) {
      if (p.x < x0) x0 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.x > x1) x1 = p.x;
      if (p.y > y1) y1 = p.y;
    }
    const { edges } = this.queryBox(x0, y0, x1, y1);
    const out: Edge[] = [];
    for (const e of edges) {
      if (ROADS[e.kind].lanes >= spec.lanes) continue;
      if (ROADS[e.kind].gradeSeparated) continue;
      let covered = 0;
      let total = 0;
      for (let i = 0; i < e.pts.length - 1; i++) {
        const a = e.pts[i];
        const b = e.pts[i + 1];
        const segLen = dist(a, b);
        const n = Math.max(1, Math.round(segLen / 9));
        for (let s = 0; s < n; s++) {
          const f = (s + 0.5) / n;
          const p = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
          total++;
          if (distToPolyline(p, pts) < tol) covered++;
        }
      }
      if (total > 0 && covered / total > 0.6) out.push(e);
    }
    return out;
  }

  // ------------------------------------------------------------------ build

  /** Price a polyline. */
  estimateCost(pts: readonly Vec2[], kind: RoadKind): { cost: number; length: number; water: number } {
    const spec = ROADS[kind];
    let cost = 0;
    let water = 0;
    let length = 0;
    const step = Math.max(3, CELL);
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const segLen = dist(a, b);
      if (segLen < 1e-6) continue;
      length += segLen;
      const n = Math.max(1, Math.ceil(segLen / step));
      for (let s = 0; s < n; s++) {
        const f = (s + 0.5) / n;
        const ty = this.terrain.typeAt(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f);
        if (ty <= 1) water += segLen / n;
        cost += (segLen / n) * spec.cost * terrainMult(ty);
      }
    }
    if (water > 4) {
      cost += ECONOMY.bridgeSurcharge * (kind === 'highway' ? 2.4 : kind === 'avenue' ? 1.6 : 1);
    }
    return { cost, length, water };
  }

  /** Cut a polyline down to the length the remaining budget can pave. */
  private trimToBudget(pts: Vec2[], kind: RoadKind, budget: number): Vec2[] | null {
    const spec = ROADS[kind];
    const step = 4;
    const out: Vec2[] = [{ ...pts[0] }];
    let spent = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const segLen = dist(a, b);
      if (segLen < 1e-6) continue;
      const n = Math.max(1, Math.ceil(segLen / step));
      for (let s = 0; s < n; s++) {
        const f0 = s / n;
        const f1 = (s + 1) / n;
        const mid = { x: a.x + (b.x - a.x) * (f0 + f1) * 0.5, y: a.y + (b.y - a.y) * (f0 + f1) * 0.5 };
        const unit = (segLen / n) * spec.cost * terrainMult(this.terrain.typeAt(mid.x, mid.y));
        if (spent + unit > budget) {
          const f = clamp01((budget - spent) / Math.max(1e-6, unit));
          const fe = f0 + (f1 - f0) * f;
          out.push({ x: a.x + (b.x - a.x) * fe, y: a.y + (b.y - a.y) * fe });
          return out.length >= 2 ? out : null;
        }
        spent += unit;
        out.push({ x: a.x + (b.x - a.x) * f1, y: a.y + (b.y - a.y) * f1 });
      }
    }
    return null;
  }

  /**
   * Turn a freehand stroke into road geometry.
   */
  buildPath(
    raw: Vec2[],
    kind: RoadKind,
    budget: number,
    opts: { bridge?: boolean; angleSnap?: boolean; gridSnap?: boolean } = {},
  ): BuildResult {
    if (raw.length < 2) return fail('too-short');
    let pts = dedupe(raw, 1.5);
    if (pts.length < 2) return fail('too-short');
    pts = simplify(pts, BUILD.simplifyTolerance);
    if (opts.angleSnap !== false) pts = snapPolylineAngles(pts, BUILD.angleStep, BUILD.angleTolerance);
    if (opts.gridSnap !== false) {
      const first = pts[0];
      const last = pts[pts.length - 1];
      pts[0] = { x: roundTo(first.x, BUILD.grid), y: roundTo(first.y, BUILD.grid) };
      pts[pts.length - 1] = { x: roundTo(last.x, BUILD.grid), y: roundTo(last.y, BUILD.grid) };
      pts = dedupe(pts, 0.6);
      if (pts.length < 2 || polylineLength(pts) < BUILD.minLength) return fail('too-short');
    }
    pts = mergeShortSegments(pts, BUILD.minSegment);
    pts = smoothPolyline(pts, 2, BUILD.minSegment * 0.55);
    pts = dedupe(pts, 0.6);
    if (pts.length < 2) return fail('too-short');
    if (polylineLength(pts) < BUILD.minLength) return fail('too-short');

    const allowBridge = opts.bridge !== false;

    // --- upgrade: pull out the narrower roads this stroke is replacing
    let refund = 0;
    const replaced: number[] = [];
    for (const old of this.findUpgradable(pts, kind)) {
      refund += old.cost * ECONOMY.refund;
      replaced.push(old.id);
      this.removeEdge(old.id);
    }
    if (replaced.length) {
      this.pruneOrphans();
      budget += refund;
    }

    // --- snap endpoints first so the arc lengths we work with are final
    const endAttaches: (Attach | null)[] = [null, null];
    for (const endIdx of [0, pts.length - 1] as const) {
      const p = pts[endIdx];
      const n = this.nearestNode(p.x, p.y, BUILD.nodeSnap);
      if (n) {
        pts[endIdx] = { x: n.x, y: n.y };
        endAttaches[endIdx === 0 ? 0 : 1] = { s: 0, p: { x: n.x, y: n.y }, node: n, priority: 2 };
        continue;
      }
      const hit = this.nearestEdgePoint(p.x, p.y, BUILD.edgeSnap);
      if (hit) {
        pts[endIdx] = { ...hit.point };
        endAttaches[endIdx === 0 ? 0 : 1] = { s: 0, p: { ...hit.point }, edge: hit.edge, priority: 1 };
      }
    }

    const cum = cumulative(pts);
    const total = cum[cum.length - 1];
    const est = this.estimateCost(pts, kind);
    if (est.water > 4 && !allowBridge) {
      return fail('no-bridge', 'That route crosses water and bridges are locked here.');
    }
    if (est.cost > budget && budget < est.cost * 0.25) {
      return fail('no-funds', `Needs about ${Math.ceil(est.cost)}.`);
    }

    const attaches: Attach[] = [];
    if (endAttaches[0]) attaches.push({ ...endAttaches[0], s: 0 });
    else attaches.push({ s: 0, p: { ...pts[0] }, priority: 0 });
    attaches.push(...this.collectInteriorAttachments(pts, cum, kind));
    if (endAttaches[1]) attaches.push({ ...endAttaches[1], s: total });
    else attaches.push({ s: total, p: { ...pts[pts.length - 1] }, priority: 0 });

    // sort + merge near-duplicates, always keeping the two ends
    attaches.sort((p, q) => p.s - q.s || q.priority - p.priority);
    const merged: Attach[] = [];
    for (const a of attaches) {
      a.s = clamp(a.s, 0, total);
      const last = merged[merged.length - 1];
      if (last && a.s - last.s < 9) {
        if (a.priority > last.priority && a.s < total - 0.01) merged[merged.length - 1] = a;
        else if (a.s >= total - 0.01) merged[merged.length - 1] = a;
        continue;
      }
      merged.push(a);
    }
    merged[0].s = 0;
    merged[merged.length - 1].s = total;
    if (merged.length < 2) return fail('too-short');

    const cuts = merged.slice(1, -1).map((a) => a.s);
    const subs = cutPolyline(pts, cum, cuts);
    if (subs.length !== merged.length - 1) {
      // geometry degenerated; fall back to one straight-ish edge chain
      return fail('too-short');
    }

    // resolve a node for every boundary
    const boundaries: RNode[] = merged.map((a) => this.resolveAttach(a));

    const created: Edge[] = [];
    let spent = 0;
    let bridges = 0;
    let length = 0;
    let partial = false;

    for (let i = 0; i < subs.length; i++) {
      const sub = subs[i];
      const L = polylineLength(sub);
      const a = boundaries[i];
      let b = boundaries[i + 1];
      if (L < 3 || a.id === b.id) {
        // collapse: drop the redundant node and carry the previous one forward
        if (b.edges.length === 0 && b.zoneId === null) this.removeNode(b.id);
        boundaries[i + 1] = a;
        continue;
      }
      const subEst = this.estimateCost(sub, kind);
      if (spent + subEst.cost > budget + 0.5) {
        // pave as far as the purse allows instead of refusing the whole road
        const left = budget - spent;
        const trimmed = left > ROADS[kind].cost * 14 ? this.trimToBudget(sub, kind, left) : null;
        if (trimmed && polylineLength(trimmed) > BUILD.minLength * 0.75) {
          const tEst = this.estimateCost(trimmed, kind);
          const end = trimmed[trimmed.length - 1];
          const tail = this.addNode(end.x, end.y, 'end');
          const edge = this.addEdge(a, tail, trimmed, kind, tEst.cost);
          edge.bridge = tEst.water > 4;
          if (edge.bridge) bridges++;
          edge.buildT = 0;
          edge.builtLen = 0;
          if (kind === 'highway') edge.viaduct = this.findGradeCrossings(edge);
          spent += tEst.cost;
          length += tEst.length;
          created.push(edge);
          a.pulse = 1;
          tail.pulse = 1;
          boundaries[i + 1] = tail;
          if (b.edges.length === 0 && b.zoneId === null) this.removeNode(b.id);
        }
        partial = true;
        break;
      }
      const edge = this.addEdge(a, b, sub, kind, subEst.cost);
      edge.bridge = subEst.water > 4;
      if (edge.bridge) bridges++;
      edge.buildT = 0;
      edge.builtLen = 0;
      if (kind === 'highway') edge.viaduct = this.findGradeCrossings(edge);
      spent += subEst.cost;
      length += L;
      created.push(edge);
      a.pulse = 1;
      b.pulse = 1;
    }

    if (!created.length) {
      this.pruneOrphans();
      const r = partial ? fail('no-funds', `Needs about ${Math.ceil(est.cost)}.`) : fail('too-short');
      r.refund = refund;
      r.replaced = replaced;
      return r;
    }

    this.pruneOrphans();
    return {
      ok: true,
      reason: 'ok',
      edges: created,
      cost: spent,
      refund,
      length,
      bridges,
      partial,
      replaced,
      message: partial ? `Out of funds after ${Math.round(length)} m.` : undefined,
    };
  }

  private resolveAttach(a: Attach): RNode {
    if (a.node) return a.node;
    if (a.edge) return this.splitEdge(a.edge, a.p);
    return this.addNode(a.p.x, a.p.y, 'end');
  }

  private findGradeCrossings(e: Edge): number[] {
    const out: number[] = [];
    for (let i = 0; i < e.pts.length - 1; i++) {
      const a = e.pts[i];
      const b = e.pts[i + 1];
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      const near = this.query(mid.x, mid.y, Math.max(48, dist(a, b) * 0.75)).edges;
      for (const o of near) {
        if (o.id === e.id || o.kind === 'highway') continue;
        for (let j = 0; j < o.pts.length - 1; j++) {
          const hit = segmentIntersection(a, b, o.pts[j], o.pts[j + 1]);
          if (hit) {
            const pr = projectOnSegment(hit, a, b);
            out.push(e.cum[i] + pr.d);
          }
        }
      }
    }
    return out.sort((p, q) => p - q);
  }

  /**
   * Junctions created where the new stroke crosses the existing network.
   * Freeways grade-separate over surface roads: a crossing only becomes a
   * junction if it happens right at the stroke's endpoint (i.e. a ramp).
   */
  private collectInteriorAttachments(pts: Vec2[], cum: number[], kind: RoadKind): Attach[] {
    const total = cum[cum.length - 1];
    const out: Attach[] = [];
    const isFw = kind === 'highway';
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of pts) {
      if (p.x < x0) x0 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.x > x1) x1 = p.x;
      if (p.y > y1) y1 = p.y;
    }
    const { nodes, edges } = this.queryBox(x0, y0, x1, y1);

    for (const e of edges) {
      const surfaceMeet = isFw !== (e.kind === 'highway');
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i];
        const b = pts[i + 1];
        for (let j = 0; j < e.pts.length - 1; j++) {
          const hit = segmentIntersection(a, b, e.pts[j], e.pts[j + 1]);
          if (!hit) continue;
          const pr = projectOnSegment(hit, a, b);
          const s = cum[i] + pr.d;
          if (s < 6 || s > total - 6) continue; // endpoint handling lives elsewhere
          if (surfaceMeet) continue; // fly over / under
          out.push({ s, p: hit, edge: e, priority: 1 });
        }
      }
    }

    for (const n of nodes) {
      let bestD = BUILD.edgeSnap;
      let bestS = -1;
      let bestP: Vec2 | null = null;
      for (let i = 0; i < pts.length - 1; i++) {
        const pr = projectOnSegment(n, pts[i], pts[i + 1]);
        if (pr.dist < bestD) {
          const s = cum[i] + pr.d;
          if (s < 6 || s > total - 6) continue;
          bestD = pr.dist;
          bestS = s;
          bestP = pr.point;
        }
      }
      if (bestS >= 0 && bestP) out.push({ s: bestS, p: bestP, node: n, priority: 2 });
    }
    return out;
  }

  // ---------------------------------------------------------------- bulldoze

  edgeAt(x: number, y: number, r: number): Edge | null {
    const hit = this.nearestEdgePoint(x, y, r);
    return hit ? hit.edge : null;
  }

  deleteArea(x: number, y: number, r: number): Edge[] {
    const { edges } = this.query(x, y, r + 8);
    const removed: Edge[] = [];
    for (const e of edges) {
      for (let i = 0; i < e.pts.length - 1; i++) {
        const pr = projectOnSegment({ x, y }, e.pts[i], e.pts[i + 1]);
        if (pr.dist <= r) {
          const gone = this.removeEdge(e.id);
          if (gone) removed.push(gone);
          break;
        }
      }
    }
    if (removed.length) this.pruneOrphans();
    return removed;
  }

  // ------------------------------------------------------------- car buckets

  attachCar(e: Edge, car: Car): void {
    const list = car.dir === 1 ? e.carsF : e.carsB;
    let lo = 0;
    let hi = list.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].t < car.t) lo = mid + 1;
      else hi = mid;
    }
    list.splice(lo, 0, car);
  }

  detachCar(e: Edge, car: Car): void {
    const list = car.dir === 1 ? e.carsF : e.carsB;
    const i = list.indexOf(car);
    if (i >= 0) list.splice(i, 1);
  }

  // ---------------------------------------------------------------- sim state

  refreshState(): void {
    for (const e of this.edges) {
      const n = e.carsF.length + e.carsB.length;
      e.density = n / Math.max(1, e.cap);
      e.congestion = clamp01(e.density / 0.8);
      let sum = 0;
      for (const c of e.carsF) sum += c.speed;
      for (const c of e.carsB) sum += c.speed;
      const avg = n > 0 ? sum / n : e.freeSpeed;
      e.avgSpeed += (avg - e.avgSpeed) * 0.12;
      e.flow = n * e.avgSpeed * 0.02;
      if (e.buildT < 1) {
        e.buildT = clamp01(e.buildT + 0.055);
        e.builtLen = e.len * e.buildT;
      }
    }
    for (const nd of this.nodes) {
      if (nd.edges.length < 3) {
        nd.pressure *= 0.9;
        if (nd.pulse > 0) nd.pulse = Math.max(0, nd.pulse - 0.03);
        continue;
      }
      let c = 0;
      let f = 0;
      for (const id of nd.edges) {
        const e = this.edgeById.get(id);
        if (!e) continue;
        c += e.congestion;
        f += e.flow;
      }
      const avg = c / nd.edges.length;
      const target = clamp01(avg * (1 + 0.14 * (nd.edges.length - 2)) + Math.min(0.35, f * 0.0016));
      nd.pressure += (target - nd.pressure) * 0.08;
      nd.flow = f;
      if (nd.pulse > 0) nd.pulse = Math.max(0, nd.pulse - 0.03);
    }
  }

  // ---------------------------------------------------------------- snapshots

  snapshot(): Snapshot {
    return {
      nodes: this.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, kind: n.kind, zoneId: n.zoneId })),
      edges: this.edges.map((e) => ({
        id: e.id,
        a: e.a,
        b: e.b,
        kind: e.kind,
        pts: e.pts.map((p) => [p.x, p.y] as [number, number]),
        bridge: e.bridge,
        cost: e.cost,
      })),
      nextNodeId: this.nextNodeId,
      nextEdgeId: this.nextEdgeId,
    };
  }

  restore(s: Snapshot): void {
    this.clear();
    this.nextNodeId = s.nextNodeId;
    this.nextEdgeId = s.nextEdgeId;
    for (const n of s.nodes) {
      const node: RNode = {
        id: n.id,
        x: n.x,
        y: n.y,
        edges: [],
        kind: n.kind,
        zoneId: n.zoneId,
        pressure: 0,
        flow: 0,
        pulse: 0,
      };
      this.nodes.push(node);
      this.nodeById.set(node.id, node);
    }
    for (const e of s.edges) {
      const a = this.nodeById.get(e.a);
      const b = this.nodeById.get(e.b);
      if (!a || !b) continue;
      const pts = dedupe(
        e.pts.map((p) => ({ x: p[0], y: p[1] })),
        0.3,
      );
      if (pts.length < 2) continue;
      const cumArr = cumulative(pts);
      const len = Math.max(0.001, cumArr[cumArr.length - 1]);
      const edge: Edge = {
        id: e.id,
        a: e.a,
        b: e.b,
        kind: e.kind,
        pts,
        cum: cumArr,
        len,
        bridge: e.bridge,
        cost: e.cost,
        buildT: 1,
        lanesPerDir: Math.max(1, ROADS[e.kind].lanes / 2),
        freeSpeed: ROADS[e.kind].speed,
        cap: Math.max(2, Math.floor(len / CAR_SPACING) * ROADS[e.kind].lanes),
        viaduct: [],
        carsF: [],
        carsB: [],
        density: 0,
        congestion: 0,
        avgSpeed: ROADS[e.kind].speed,
        flow: 0,
        builtLen: len,
      };
      a.edges.push(edge.id);
      b.edges.push(edge.id);
      if (a.edges.length > 1) a.kind = 'junction';
      if (b.edges.length > 1) b.kind = 'junction';
      this.edges.push(edge);
      this.edgeById.set(edge.id, edge);
    }
    for (const e of this.edges) if (e.kind === 'highway') e.viaduct = this.findGradeCrossings(e);
    this.indexDirty = true;
  }

  stats(): { length: number; cost: number; edges: number; nodes: number; byKind: Record<RoadKind, number> } {
    const byKind: Record<RoadKind, number> = { street: 0, avenue: 0, highway: 0 };
    let length = 0;
    let cost = 0;
    for (const e of this.edges) {
      length += e.len;
      cost += e.cost;
      byKind[e.kind] += e.len;
    }
    return { length, cost, edges: this.edges.length, nodes: this.nodes.length, byKind };
  }
}

// ------------------------------------------------------------------- helpers

export function terrainMult(t: number): number {
  switch (t) {
    case 0:
    case 1:
      return 2.3;
    case 4:
      return 1.35;
    case 5:
      return 1.7;
    case 6:
      return 1.2;
    case 7:
      return 1.25;
    default:
      return 1;
  }
}

export function pointAtArc(e: Edge, t: number): Vec2 {
  const tt = clamp(t, 0, e.len);
  let lo = 0;
  let hi = e.cum.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (e.cum[mid] <= tt) lo = mid;
    else hi = mid;
  }
  const a = e.pts[lo];
  const b = e.pts[hi];
  const segLen = e.cum[hi] - e.cum[lo];
  const f = segLen < 1e-6 ? 0 : (tt - e.cum[lo]) / segLen;
  return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
}

export function headingAtArc(e: Edge, t: number): number {
  const tt = clamp(t, 0, e.len);
  let lo = 0;
  let hi = e.cum.length - 1;
  while (lo + 1 < hi) {
    const mid = (lo + hi) >> 1;
    if (e.cum[mid] <= tt) lo = mid;
    else hi = mid;
  }
  const a = e.pts[lo];
  const b = e.pts[hi];
  return Math.atan2(b.y - a.y, b.x - a.x);
}

export function distToPolyline(p: Vec2, pts: readonly Vec2[]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = projectOnSegment(p, pts[i], pts[i + 1]).dist;
    if (d < best) best = d;
  }
  return best;
}

function mergeShortSegments(pts: Vec2[], min: number): Vec2[] {
  if (pts.length < 3) return pts;
  const out: Vec2[] = [pts[0]];
  for (let i = 1; i < pts.length - 1; i++) {
    if (dist(out[out.length - 1], pts[i]) >= min) out.push(pts[i]);
  }
  const last = pts[pts.length - 1];
  if (dist(out[out.length - 1], last) < min * 0.5 && out.length > 1) out[out.length - 1] = last;
  else out.push(last);
  return out;
}

/** Split a polyline at the given ascending arc lengths. */
export function cutPolyline(pts: Vec2[], cum: number[], cuts: number[]): Vec2[][] {
  const total = cum[cum.length - 1];
  const uniq: number[] = [];
  for (const c of cuts) {
    const cc = clamp(c, 0, total);
    if (cc <= 0.5 || cc >= total - 0.5) continue;
    if (!uniq.length || cc - uniq[uniq.length - 1] > 0.5) uniq.push(cc);
  }
  if (!uniq.length) return [pts.map((p) => ({ ...p }))];

  const out: Vec2[][] = [];
  let current: Vec2[] = [{ ...pts[0] }];
  let cutIdx = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const segStart = cum[i];
    const segLen = cum[i + 1] - segStart;
    while (cutIdx < uniq.length && segLen > 1e-9 && segStart + segLen >= uniq[cutIdx] - 1e-6) {
      const f = clamp((uniq[cutIdx] - segStart) / segLen, 0, 1);
      const p = { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
      current.push({ ...p });
      out.push(current);
      current = [{ ...p }];
      cutIdx++;
    }
    current.push({ ...b });
  }
  if (current.length > 1) out.push(current);
  return out;
}
