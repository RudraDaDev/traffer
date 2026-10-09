/**
 * Procedural level generation: endless runs, the daily challenge and sandbox
 * worlds. Everything is derived from a seed string, so a run can be shared and
 * replayed exactly.
 */

import { RNG, hashString, mixSeeds } from '../core/rng';
import { clamp } from '../core/math';
import type { GameMode, ZoneKind } from './config';
import type { LevelDef, TerrainSpec, ZoneSpec } from './types';
import { ALL_TOOLS } from './types';

export interface GenOpts {
  mode: GameMode;
  seed: string;
  /** 0 = gentle, 10+ = brutal */
  difficulty?: number;
  size?: number;
  /** sandbox: hand the player an empty purse or an infinite one */
  budget?: number;
}

export function dailySeed(date = new Date()): string {
  const y = date.getUTCFullYear();
  const m = (date.getUTCMonth() + 1).toString().padStart(2, '0');
  const d = date.getUTCDate().toString().padStart(2, '0');
  return `${y}${m}${d}`;
}

export function dayOfYear(date = new Date()): number {
  const start = Date.UTC(date.getUTCFullYear(), 0, 1);
  const now = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  return Math.floor((now - start) / 86400000);
}

export function generateLevel(opts: GenOpts): LevelDef {
  const difficulty = clamp(opts.difficulty ?? 0, 0, 40);
  const seed = opts.seed || 'traffer';
  const rng = new RNG(mixSeeds(seed, opts.mode, difficulty));
  const sandbox = opts.mode === 'sandbox';

  const size = opts.size ?? Math.round(clamp(940 + difficulty * 26 + rng.float(-60, 60), 860, 1500) / 20) * 20;
  const zoneCount = sandbox
    ? clamp(4 + Math.round(rng.float(0, 5)), 3, 12)
    : clamp(3 + Math.round(difficulty * 0.7) + rng.int(0, 2), 3, 14);

  // ---- terrain ------------------------------------------------------------
  const waterRoll = rng.next();
  const terrain: TerrainSpec = {
    sea: rng.float(0.02, 0.1 + difficulty * 0.006),
    forest: rng.float(0.1, 0.4),
    rock: rng.float(0.02, 0.24),
    rivers: waterRoll > 0.42 ? rng.int(1, difficulty > 5 ? 3 : 2) : 0,
    riverDir: rng.pick(['h', 'v', 'd', 'any'] as ('h' | 'v' | 'd' | 'any')[]),
    riverWidth: rng.float(18, 40),
    lakes: waterRoll < 0.28 ? rng.int(1, 3) : 0,
    coast: rng.chance(0.25) ? rng.pick(['n', 's', 'e', 'w'] as ('n' | 's' | 'e' | 'w')[]) : 'none',
    urban: [],
    blocks: [],
  };
  const urbanCount = rng.int(1, Math.min(4, 1 + Math.floor(zoneCount / 3)));
  for (let i = 0; i < urbanCount; i++) {
    terrain.urban!.push([rng.float(0.2, 0.8), rng.float(0.2, 0.8), rng.float(0.08, 0.2)]);
  }
  if (difficulty > 3) {
    const blocks = rng.int(0, Math.min(5, Math.floor(difficulty / 2)));
    for (let i = 0; i < blocks; i++) {
      terrain.blocks!.push([rng.float(0.15, 0.85), rng.float(0.15, 0.85), rng.float(0.05, 0.11)]);
    }
  }

  // ---- districts ----------------------------------------------------------
  const zoneList: ZoneSpec[] = [];
  const kinds: ZoneKind[] = ['R', 'C', 'I'];
  let attempts = 0;
  while (zoneList.length < zoneCount && attempts++ < 900) {
    const edgeBias = rng.chance(0.55);
    let x: number;
    let y: number;
    if (edgeBias) {
      // push districts toward the rim so routes are long and interesting
      const side = rng.int(0, 3);
      const t = rng.float(0.12, 0.88);
      const m = rng.float(0.08, 0.24);
      x = side === 0 ? m : side === 1 ? 1 - m : t;
      y = side === 2 ? m : side === 3 ? 1 - m : t;
    } else {
      x = rng.float(0.12, 0.88);
      y = rng.float(0.12, 0.88);
    }
    const minSep = clamp(0.62 / Math.sqrt(zoneCount), 0.14, 0.34);
    let ok = true;
    for (const z of zoneList) {
      if (Math.hypot(z.x - x, z.y - y) < minSep) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;

    // composition: a mix, weighted so there is always something to commute to
    const haveR = zoneList.filter((z) => z.kind === 'R').length;
    const haveC = zoneList.filter((z) => z.kind === 'C').length;
    const haveI = zoneList.filter((z) => z.kind === 'I').length;
    let kind: ZoneKind;
    if (haveC === 0) kind = 'C';
    else if (haveR === 0) kind = 'R';
    else if (haveI === 0 && zoneList.length > 2) kind = 'I';
    else {
      kind = rng.pickWeighted(kinds, (k) => (k === 'R' ? 1.2 : k === 'C' ? 1 : 0.6));
    }
    void haveR;
    void haveC;
    void haveI;
    zoneList.push({
      x,
      y,
      kind,
      weight: rng.float(0.8, 1.5),
      color: zoneList.length,
    });
  }
  if (zoneList.length < 2) {
    zoneList.length = 0;
    zoneList.push({ x: 0.25, y: 0.5, kind: 'R', weight: 1, color: 0 });
    zoneList.push({ x: 0.75, y: 0.5, kind: 'C', weight: 1, color: 1 });
  }

  // ---- economy ------------------------------------------------------------
  const budget = sandbox
    ? opts.budget ?? 1e9
    : Math.round(clamp(size * 2.1 + zoneCount * 1000 + difficulty * 120, 3200, 24000) / 50) * 50;

  const deliver =
    opts.mode === 'campaign'
      ? 100
      : sandbox
        ? 0
        : Math.round(60 + difficulty * 40 + zoneCount * 12);

  const level: LevelDef = {
    id: `${opts.mode}-${seed}-${difficulty}`,
    name:
      opts.mode === 'daily'
        ? `Daily · ${seed}`
        : opts.mode === 'sandbox'
          ? 'Sandbox'
          : `Endless · ${seed.toUpperCase().slice(0, 6)}`,
    chapter: -1,
    size,
    seed,
    terrain,
    zones: zoneList,
    goal: {
      deliver: sandbox ? 0 : deliver,
      budget,
      time: 0,
      jamFails: !sandbox,
    },
    tools: { ...ALL_TOOLS, zone: sandbox, highway: difficulty >= 2 || sandbox },
    demand: sandbox
      ? { start: 0.55, end: 0.9, rampEnd: 120 }
      : { start: 0.5, end: 1 + difficulty * 0.1, rampEnd: 110 + difficulty * 14 },
    brief:
      opts.mode === 'daily'
        ? 'Everyone gets the same city today. Beat your yesterday.'
        : opts.mode === 'sandbox'
          ? 'No goal, no timer, unlimited funds. Build the network you always wanted.'
          : 'The city grows forever. Survive as long as you can and deliver as many commuters as possible.',
    mode: opts.mode,
    difficulty,
  };
  return level;
}

/** A stable, reproducible endless seed from a run number. */
export function endlessSeed(run: number): string {
  const h = hashString('endless' + run);
  const chars = 'ACDEFGHJKLMNPQRTUVWXY3479';
  let s = '';
  for (let i = 0; i < 5; i++) s += chars[Math.floor(h / Math.pow(7, i)) % chars.length];
  return s;
}

/** Difficulty curve for an endless run, from delivered commuters + time. */
export function endlessDifficulty(delivered: number, seconds: number): number {
  return clamp(delivered / 55 + seconds / 150, 0, 26);
}

export function sandboxLevel(seed: string, size = 1200): LevelDef {
  return generateLevel({ mode: 'sandbox', seed, size });
}
