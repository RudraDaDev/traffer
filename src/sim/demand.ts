/** Districts (zones) and the origin/destination demand between them. */

import { DISTRICT_COLORS, ZONE_NAMES, type ZoneKind } from '../game/config';
import { clamp01, dist } from '../core/math';
import { reachable } from '../net/path';
import type { Network, RNode } from '../net/network';
import type { ZoneSpec } from '../game/types';
import { RNG } from '../core/rng';

export interface Zone {
  id: number;
  x: number;
  y: number;
  kind: ZoneKind;
  colorIdx: number;
  color: string;
  name: string;
  /** radius in which a road node counts as "serving" this district */
  radius: number;
  baseRate: number;
  rate: number;
  anchor: RNode | null;
  served: number;
  spawned: number;
  lost: number;
  spawnAcc: number;
  /** weighted destination zone ids */
  targets: { id: number; w: number }[];
  pulse: number;
  /** 0..1 — how angry this district is (unconnected or gridlocked) */
  unhappy: number;
  /** commuters currently in transit from/to here */
  inTransit: number;
  /** how many other districts can currently be reached from here */
  linked: number;
}

/** commuters generated per second by a district of weight 1 */
export const BASE_RATE = 0.55;

const FLOW_WEIGHT: Record<ZoneKind, Record<ZoneKind, number>> = {
  R: { R: 0.12, C: 1.0, I: 0.55 },
  C: { R: 1.0, C: 0.22, I: 0.38 },
  I: { R: 0.85, C: 0.4, I: 0.12 },
};

let nameCounters: Record<string, number> = {};

const NAME_A = [
  'Ash',
  'Birch',
  'Cedar',
  'Dove',
  'Elm',
  'Ferry',
  'Granite',
  'Harbour',
  'Ivy',
  'Juniper',
  'Kiln',
  'Lark',
  'Mill',
  'North',
  'Oak',
  'Pier',
  'Quarry',
  'Rose',
  'South',
  'Temple',
  'Umber',
  'Vale',
  'West',
  'Yarrow',
];
const NAME_B = ['field', 'gate', 'town', 'side', 'bury', 'haven', 'ridge', 'ford', 'wick', 'hill', 'dale', 'port'];

export function districtName(rng: RNG, kind: ZoneKind): string {
  const key = kind;
  nameCounters[key] = (nameCounters[key] ?? 0) + 1;
  const n = nameCounters[key];
  if (n > 24) return `${ZONE_NAMES[kind]} ${n}`;
  return rng.pick(NAME_A) + rng.pick(NAME_B);
}

export function resetDistrictNames(): void {
  nameCounters = {};
}

export class Demand {
  zones: Zone[] = [];
  private net: Network;

  constructor(net: Network) {
    this.net = net;
  }

  clear(): void {
    this.zones = [];
  }

  add(
    x: number,
    y: number,
    kind: ZoneKind,
    opts: { colorIdx?: number; name?: string; weight?: number; radius?: number } = {},
  ): Zone {
    const id = this.zones.length;
    const colorIdx = opts.colorIdx ?? id % DISTRICT_COLORS.length;
    const z: Zone = {
      id,
      x,
      y,
      kind,
      colorIdx,
      color: DISTRICT_COLORS[colorIdx % DISTRICT_COLORS.length],
      name: opts.name ?? districtName(new RNG(x * 31 + y * 17 + id), kind),
      radius: opts.radius ?? 62,
      baseRate: BASE_RATE * (opts.weight ?? 1),
      rate: BASE_RATE * (opts.weight ?? 1),
      anchor: null,
      served: 0,
      spawned: 0,
      lost: 0,
      spawnAcc: 0,
      targets: [],
      pulse: 0,
      unhappy: 1,
      inTransit: 0,
      linked: 0,
    };
    this.zones.push(z);
    this.rebuildMatrix();
    return z;
  }

  fromSpecs(specs: ZoneSpec[]): Zone[] {
    for (let i = 0; i < specs.length; i++) {
      const s = specs[i];
      this.add(s.x, s.y, s.kind, {
        weight: s.weight ?? 1,
        colorIdx: s.color ?? i % DISTRICT_COLORS.length,
        name: s.name,
      });
    }
    return this.zones;
  }

  /** Recompute who travels where. */
  rebuildMatrix(): void {
    for (const z of this.zones) {
      z.targets = [];
      for (const o of this.zones) {
        if (o.id === z.id) continue;
        const w = FLOW_WEIGHT[z.kind][o.kind] * (0.6 + o.baseRate);
        const d = Math.max(60, dist(z, o));
        z.targets.push({ id: o.id, w: (w * 900) / d });
      }
      const total = z.targets.reduce((a, b) => a + b.w, 0);
      if (total > 0) for (const t of z.targets) t.w /= total;
    }
  }

  pickDestination(z: Zone, rng: RNG): Zone | null {
    if (!z.targets.length) return null;
    const r = rng.next();
    let acc = 0;
    for (const t of z.targets) {
      acc += t.w;
      if (r <= acc) return this.zones[t.id] ?? null;
    }
    return this.zones[z.targets[z.targets.length - 1].id] ?? null;
  }

  /** Bind every district to the closest road node inside its radius. */
  updateAnchors(): void {
    for (const z of this.zones) {
      const ok = z.anchor && z.anchor.edges.length > 0 && dist(z.anchor, z) <= z.radius * 1.6;
      if (ok) continue;
      let best: RNode | null = null;
      let bd = z.radius * z.radius;
      for (const n of this.net.nodes) {
        if (!n.edges.length) continue;
        const d = (n.x - z.x) * (n.x - z.x) + (n.y - z.y) * (n.y - z.y);
        if (d < bd) {
          bd = d;
          best = n;
        }
      }
      z.anchor = best;
      z.unhappy = best ? Math.max(0, z.unhappy - 0.4) : Math.min(1, z.unhappy + 0.1);
    }
  }

  /**
   * Work out which districts can actually reach each other right now. Throttled
   * by the caller — it is only used for labels and hints.
   */
  updateLinks(): void {
    const anchored = this.zones.filter((z) => z.anchor);
    for (const z of this.zones) z.linked = 0;
    for (const z of anchored) {
      const seen = reachable(this.net, z.anchor!);
      let n = 0;
      for (const o of anchored) {
        if (o.id !== z.id && seen.has(o.anchor!.id)) n++;
      }
      z.linked = n;
    }
  }

  /** Apply the demand ramp and decay visual state. */
  tick(dt: number, elapsed: number, ramp: { start: number; end: number; rampEnd: number }): void {
    const k = ramp.rampEnd > 0 ? clamp01(elapsed / ramp.rampEnd) : 1;
    const mult = ramp.start + (ramp.end - ramp.start) * k * k;
    for (const z of this.zones) {
      z.rate = z.baseRate * mult;
      z.spawnAcc += z.rate * dt;
      if (z.pulse > 0) z.pulse = Math.max(0, z.pulse - dt * 1.6);
      if (z.anchor) z.unhappy = Math.max(0, z.unhappy - dt * 0.5);
      else z.unhappy = Math.min(1, z.unhappy + dt * 0.25);
    }
  }

  consumeSpawn(z: Zone): boolean {
    if (z.spawnAcc >= 1) {
      z.spawnAcc -= 1;
      return true;
    }
    return false;
  }

  totalRate(): number {
    return this.zones.reduce((a, z) => a + (z.anchor ? z.rate : 0), 0);
  }

  totalServed(): number {
    return this.zones.reduce((a, z) => a + z.served, 0);
  }
}
