/**
 * A small greedy planner.
 *
 * It is used three ways: to build the attract-mode city behind the menus, to
 * power the in-game hint arrow, and (offline) to sanity-check that every
 * campaign level can actually be solved inside its budget.
 */

import { RNG } from '../core/rng';
import { clamp, dist, type Vec2 } from '../core/math';
import type { Network, RNode } from '../net/network';
import { ROADS } from './config';
import { findRoute, isConnected } from '../net/path';
import type { Zone } from '../sim/demand';
import type { RoadKind } from './config';

export interface PlanResult {
  cost: number;
  edges: number;
  connected: boolean;
}

function componentOf(net: Network, node: RNode): Set<number> {
  const seen = new Set<number>([node.id]);
  const stack = [node.id];
  let guard = 0;
  while (stack.length && guard++ < 100000) {
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

/** Build an L/Z shaped route between two points — looks like a real road plan. */
export function routeShape(a: Vec2, b: Vec2, rng: RNG): Vec2[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const style = rng.next();
  if (style < 0.34) {
    // L: horizontal first
    return [
      { ...a },
      { x: b.x, y: a.y },
      { ...b },
    ];
  }
  if (style < 0.68) {
    // L: vertical first
    return [
      { ...a },
      { x: a.x, y: b.y },
      { ...b },
    ];
  }
  // Z with a bias
  const t = rng.float(0.32, 0.68);
  const mid = { x: a.x + dx * t, y: a.y + dy * t };
  const offset = clamp(Math.min(Math.abs(dx), Math.abs(dy)) * 0.5, 0, 120) * rng.sign();
  if (Math.abs(dx) > Math.abs(dy)) {
    return [{ ...a }, { x: mid.x, y: a.y + offset }, { x: mid.x, y: b.y + offset }, { ...b }];
  }
  return [{ ...a }, { x: a.x + offset, y: mid.y }, { x: b.x + offset, y: mid.y }, { ...b }];
}

/**
 * Connect every district with a sensible network, then spend what is left
 * widening the worst links and adding bypasses so the city survives a jam.
 * Greedy, but it plays a recognisable game: trunk roads first, then redundancy.
 */
export function autoConnect(
  net: Network,
  zones: Zone[],
  budget: number,
  rng: RNG,
  kinds: RoadKind[] = ['street', 'avenue'],
  opts: { connectOnly?: boolean } = {},
): PlanResult {
  let spent = 0;
  let built = 0;
  let failures = 0;
  let guard = 0;

  const account = (res: { cost: number; refund: number; edges: unknown[] }): boolean => {
    if (!res.edges.length) return false;
    spent += Math.max(0, res.cost - res.refund);
    built += res.edges.length;
    return true;
  };

  while (guard++ < 400 && failures < 4) {
    net.pruneOrphans();
    refreshAnchors(net, zones);
    const remaining = budget - spent;
    if (remaining < 40) break;

    const anchored = zones.filter((z) => z.anchor);

    // 1. a district with no road at all
    if (anchored.length < zones.length) {
      const orphan = zones.find((z) => !z.anchor)!;
      const target = nearestZone(orphan, anchored) ?? nearestZone(orphan, zones);
      if (!target) break;
      const shape = routeShape(orphan, target, rng);
      const kind = chooseKind(net, shape, remaining, kinds, dist(orphan, target));
      const res = net.buildPath(shape, kind, remaining, { bridge: true });
      if (account(res)) {
        failures = 0;
        continue;
      }
      const res2 = net.buildPath([{ ...orphan }, { ...target }], 'street', remaining, { bridge: true });
      if (account(res2)) {
        failures = 0;
        continue;
      }
      failures++;
      continue;
    }

    // 2. everyone has a road but the network is in pieces
    if (!compsAreOne(net, zones)) {
      const comps: Set<number>[] = [];
      for (const z of anchored) {
        const c = componentOf(net, z.anchor!);
        if (!comps.some((cc) => cc.has(z.anchor!.id))) comps.push(c);
      }
      let bestPair: { a: Zone; b: Zone; d: number } | null = null;
      for (let i = 0; i < comps.length; i++) {
        for (let j = i + 1; j < comps.length; j++) {
          for (const za of anchored) {
            if (!comps[i].has(za.anchor!.id)) continue;
            for (const zb of anchored) {
              if (!comps[j].has(zb.anchor!.id)) continue;
              const d = dist(za, zb);
              if (!bestPair || d < bestPair.d) bestPair = { a: za, b: zb, d };
            }
          }
        }
      }
      if (!bestPair) break;
      const shape = routeShape(bestPair.a, bestPair.b, rng);
      const kind = chooseKind(net, shape, remaining, kinds, bestPair.d);
      const res = net.buildPath(shape, kind, remaining, { bridge: true });
      if (account(res)) failures = 0;
      else failures++;
      continue;
    }

    if (opts.connectOnly) break;

    // 3. fully connected: widen the most stressed link we can afford
    const widened = widenWorst(net, remaining, kinds);
    if (widened > 0) {
      spent += widened;
      built++;
      failures = 0;
      continue;
    }

    // 4. add a bypass so there is a second way around
    const pair = mostIndirectPair(net, anchored);
    if (!pair) {
      failures++;
      continue;
    }
    const shape = bypassShape(pair.a, pair.b, rng);
    const kind = chooseKind(net, shape, remaining, kinds, dist(pair.a, pair.b) * 0.9);
    const res = net.buildPath(shape, kind, remaining, { bridge: true });
    if (account(res)) failures = 0;
    else failures++;
  }

  refreshAnchors(net, zones);
  return {
    cost: spent,
    edges: built,
    connected: zones.every((z) => z.anchor) && compsAreOne(net, zones),
  };
}

export function refreshAnchors(net: Network, zones: Zone[]): void {
  for (const z of zones) {
    let best: RNode | null = null;
    let bd = (z.radius * 1.5) ** 2;
    for (const n of net.nodes) {
      if (!n.edges.length) continue;
      const d = (n.x - z.x) * (n.x - z.x) + (n.y - z.y) * (n.y - z.y);
      if (d < bd) {
        bd = d;
        best = n;
      }
    }
    if (best || !z.anchor) z.anchor = best;
  }
}

/** Pick the richest road class that still leaves room for the rest of the plan. */
export function chooseKind(
  net: Network,
  shape: Vec2[],
  remaining: number,
  kinds: RoadKind[],
  d: number,
): RoadKind {
  const order: RoadKind[] = [];
  if (d > 430 && kinds.includes('highway')) order.push('highway');
  if (d > 210 && kinds.includes('avenue')) order.push('avenue');
  order.push(kinds.includes('street') ? 'street' : kinds[0]);
  for (const k of order) {
    const c = net.estimateCost(shape, k).cost;
    const share = k === 'street' ? 1 : 0.5;
    if (c <= remaining * share) return k;
  }
  return order[order.length - 1];
}

const NEXT_CLASS: Partial<Record<RoadKind, RoadKind>> = { street: 'avenue', avenue: 'highway' };

/**
 * Rebuild the single most stressed upgradable road one class up.
 * Returns the net cost (0 when nothing was worth doing).
 */
export function widenWorst(net: Network, budget: number, kinds: RoadKind[]): number {
  let best: { pts: Vec2[]; kind: RoadKind; net: number } | null = null;
  let bestScore = 0;
  for (const e of net.edges) {
    const next = NEXT_CLASS[e.kind];
    if (!next || !kinds.includes(next)) continue;
    if (ROADS[next].gradeSeparated && ROADS[e.kind].gradeSeparated) continue;
    const score = e.congestion * Math.min(1.6, e.len / 120) + (e.density > 0.5 ? 0.25 : 0);
    if (score < 0.22 || score <= bestScore) continue;
    const est = net.estimateCost(e.pts, next).cost;
    const refund = e.cost * 0.35;
    const netCost = est - refund;
    if (netCost > budget * 0.6) continue;
    bestScore = score;
    best = { pts: e.pts.map((p) => ({ ...p })), kind: next, net: netCost };
  }
  if (!best) return 0;
  const res = net.buildPath(best.pts, best.kind, budget, { bridge: true });
  if (!res.ok || !res.edges.length) return 0;
  return Math.max(0, res.cost - res.refund);
}

function compsAreOne(net: Network, zones: Zone[]): boolean {
  const anchored = zones.filter((z) => z.anchor);
  if (anchored.length < 2) return anchored.length === zones.length;
  const first = componentOf(net, anchored[0].anchor!);
  return anchored.every((z) => first.has(z.anchor!.id));
}

function nearestZone(z: Zone, list: Zone[]): Zone | null {
  let best: Zone | null = null;
  let bd = Infinity;
  for (const o of list) {
    if (o.id === z.id) continue;
    const d = dist(z, o);
    if (d < bd) {
      bd = d;
      best = o;
    }
  }
  return best;
}

/** A route that deliberately bows away from the straight line (a bypass). */
function bypassShape(a: Vec2, b: Vec2, rng: RNG): Vec2[] {
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l = Math.hypot(dx, dy) || 1;
  const bow = clamp(l * rng.float(0.18, 0.42), 40, 260) * rng.sign();
  const nx = (-dy / l) * bow;
  const ny = (dx / l) * bow;
  return [
    { ...a },
    { x: a.x + dx * 0.3 + nx, y: a.y + dy * 0.3 + ny },
    { x: mx + nx * 1.15, y: my + ny * 1.15 },
    { x: a.x + dx * 0.72 + nx, y: a.y + dy * 0.72 + ny },
    { ...b },
  ];
}

/** Which pair of districts is served most poorly right now? */
export function mostIndirectPair(net: Network, zones: Zone[]): { a: Zone; b: Zone; ratio: number } | null {
  const anchored = zones.filter((z) => z.anchor);
  let best: { a: Zone; b: Zone; ratio: number } | null = null;
  let checked = 0;
  for (let i = 0; i < anchored.length && checked < 60; i++) {
    for (let j = i + 1; j < anchored.length && checked < 60; j++) {
      const a = anchored[i];
      const b = anchored[j];
      checked++;
      const straight = dist(a, b);
      if (straight < 40) continue;
      if (isConnected(net, a.anchor!, b.anchor!)) {
        const route = findRoute(net, a.anchor!, b.anchor!);
        const ratio = route ? route.length / straight : 3;
        if (!best || ratio > best.ratio) best = { a, b, ratio };
      } else {
        if (!best || 4 > best.ratio) best = { a, b, ratio: 4 };
      }
    }
  }
  return best;
}

/**
 * In-game hint: two points the player should probably connect.
 * Prefers an unconnected district; otherwise suggests a bypass for the pair
 * whose current route is the most indirect.
 */
export function suggestHint(net: Network, zones: Zone[]): { a: Vec2; b: Vec2; why: string } | null {
  if (zones.length < 2) return null;
  const unconnected = zones.filter((z) => !z.anchor);
  if (unconnected.length) {
    const z = unconnected[0];
    const anchored = zones.filter((o) => o.anchor);
    const target = anchored.length ? nearestZone(z, anchored) : nearestZone(z, zones);
    if (!target) return null;
    return { a: { x: z.x, y: z.y }, b: { x: target.x, y: target.y }, why: `Connect ${z.name} to the network` };
  }
  // are all districts reachable from each other?
  const first = zones[0].anchor;
  if (first) {
    const comp = componentOf(net, first);
    const outside = zones.find((z) => z.anchor && !comp.has(z.anchor.id));
    if (outside) {
      const target = zones.find((z) => z.anchor && comp.has(z.anchor.id));
      if (target) {
        return {
          a: { x: outside.x, y: outside.y },
          b: { x: target.x, y: target.y },
          why: `${outside.name} cannot reach ${target.name}`,
        };
      }
    }
  }
  const pair = mostIndirectPair(net, zones);
  if (!pair) return null;
  return {
    a: { x: pair.a.x, y: pair.a.y },
    b: { x: pair.b.x, y: pair.b.y },
    why:
      pair.ratio > 2.2
        ? `Add a shortcut between ${pair.a.name} and ${pair.b.name}`
        : `Widen the route between ${pair.a.name} and ${pair.b.name}`,
  };
}
