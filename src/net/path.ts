/** A* routing over the road graph, congestion aware. */

import { SIM } from '../game/config';
import type { Edge, Network, RNode } from './network';
import type { PathStep } from '../sim/car';

const MAX_SPEED = 96;

class MinHeap<T> {
  private items: T[] = [];
  private keys: number[] = [];

  get size(): number {
    return this.items.length;
  }

  push(item: T, key: number): void {
    const items = this.items;
    const keys = this.keys;
    items.push(item);
    keys.push(key);
    let i = items.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (keys[p] <= keys[i]) break;
      [items[p], items[i]] = [items[i], items[p]];
      [keys[p], keys[i]] = [keys[i], keys[p]];
      i = p;
    }
  }

  pop(): T | undefined {
    const items = this.items;
    const keys = this.keys;
    if (!items.length) return undefined;
    const top = items[0];
    const lastI = items.pop()!;
    const lastK = keys.pop()!;
    if (items.length) {
      items[0] = lastI;
      keys[0] = lastK;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < items.length && keys[l] < keys[m]) m = l;
        if (r < items.length && keys[r] < keys[m]) m = r;
        if (m === i) break;
        [items[m], items[i]] = [items[i], items[m]];
        [keys[m], keys[i]] = [keys[i], keys[m]];
        i = m;
      }
    }
    return top;
  }
}

/** Cost of traversing `e`, in "seconds" inflated by congestion + junctions. */
export function edgeCost(e: Edge): number {
  const time = e.len / Math.max(8, e.freeSpeed);
  const cong = 1 + SIM.congestionWeight * e.congestion + (e.avgSpeed < e.freeSpeed * 0.4 ? 0.5 : 0);
  return time * cong;
}

export interface RouteResult {
  steps: PathStep[];
  cost: number;
  length: number;
}

export function findRoute(
  net: Network,
  from: RNode | null,
  to: RNode | null,
  avoidEdge?: number,
): RouteResult | null {
  if (!from || !to || from.id === to.id) return null;
  if (!net.edges.length) return null;

  const gScore = new Map<number, number>();
  const cameFrom = new Map<number, { node: number; edge: number; dir: 1 | -1 }>();
  const closed = new Set<number>();
  const open = new MinHeap<{ id: number; x: number; y: number }>();

  gScore.set(from.id, 0);
  open.push({ id: from.id, x: from.x, y: from.y }, heuristic(from, to));

  let guard = 0;
  const maxIter = net.nodes.length * 24 + 400;

  while (open.size && guard++ < maxIter) {
    const cur = open.pop()!;
    if (closed.has(cur.id)) continue;
    closed.add(cur.id);
    if (cur.id === to.id) break;
    const node = net.getNode(cur.id);
    if (!node) continue;
    const base = gScore.get(cur.id) ?? Infinity;
    const junctionCost = node.edges.length > 2 ? node.pressure * 0.55 * SIM.junctionPenalty : 0;

    for (const eid of node.edges) {
      if (eid === avoidEdge) continue;
      const e = net.getEdge(eid);
      if (!e) continue;
      const otherId = net.otherEnd(e, cur.id);
      if (closed.has(otherId)) continue;
      const other = net.getNode(otherId);
      if (!other) continue;
      const stepCost = edgeCost(e) + junctionCost;
      const tentative = base + stepCost;
      const prev = gScore.get(otherId);
      if (prev !== undefined && prev <= tentative) continue;
      gScore.set(otherId, tentative);
      const dir: 1 | -1 = e.a === cur.id ? 1 : -1;
      cameFrom.set(otherId, { node: cur.id, edge: e.id, dir });
      open.push({ id: otherId, x: other.x, y: other.y }, tentative + heuristic(other, to));
    }
  }

  if (!closed.has(to.id)) return null;

  const steps: PathStep[] = [];
  let cur = to.id;
  let length = 0;
  let cost = 0;
  let safety = 0;
  while (cur !== from.id && safety++ < 4000) {
    const link = cameFrom.get(cur);
    if (!link) return null;
    steps.push({ e: link.edge, d: link.dir });
    const e = net.getEdge(link.edge);
    if (e) {
      length += e.len;
      cost += edgeCost(e);
    }
    cur = link.node;
  }
  steps.reverse();
  if (!steps.length) return null;
  return { steps, cost, length };
}

function heuristic(a: RNode, b: RNode): number {
  return Math.hypot(a.x - b.x, a.y - b.y) / MAX_SPEED;
}

/** Is there any connection between two nodes at all? (ignores congestion) */
export function isConnected(net: Network, from: RNode, to: RNode): boolean {
  if (from.id === to.id) return true;
  const seen = new Set<number>([from.id]);
  const stack = [from.id];
  let guard = 0;
  while (stack.length && guard++ < 20000) {
    const id = stack.pop()!;
    const n = net.getNode(id);
    if (!n) continue;
    for (const eid of n.edges) {
      const e = net.getEdge(eid);
      if (!e) continue;
      const o = net.otherEnd(e, id);
      if (o === to.id) return true;
      if (seen.has(o)) continue;
      seen.add(o);
      stack.push(o);
    }
  }
  return false;
}

/** All nodes reachable from `from`. */
export function reachable(net: Network, from: RNode): Set<number> {
  const seen = new Set<number>([from.id]);
  const stack = [from.id];
  let guard = 0;
  while (stack.length && guard++ < 50000) {
    const id = stack.pop()!;
    const n = net.getNode(id);
    if (!n) continue;
    for (const eid of n.edges) {
      const e = net.getEdge(eid);
      if (!e) continue;
      const o = net.otherEnd(e, id);
      if (seen.has(o)) continue;
      seen.add(o);
      stack.push(o);
    }
  }
  return seen;
}
