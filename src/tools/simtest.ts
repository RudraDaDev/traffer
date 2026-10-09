/**
 * Offline balance harness ("the bot plays every level").
 *
 * It runs the real terrain generator, the real greedy planner and the real
 * traffic simulation head-less, reinvesting fares exactly like a player would,
 * so budgets, goals and star pars can be calibrated instead of guessed.
 *
 *   npm run sim                 report table for the whole campaign
 *   npm run sim -- g1 m9        report specific levels
 *   npm run sim -- endless      a few procedural runs at rising difficulty
 *   npm run sim -- --calibrate  rewrite src/game/balance.ts from measurements
 */

import { writeFileSync } from 'node:fs';
import { Terrain } from '../world/terrain';
import { Network } from '../net/network';
import { Demand, resetDistrictNames } from '../sim/demand';
import { Traffic } from '../sim/traffic';
import { autoConnect } from '../game/solver';
import { LEVELS } from '../game/levels';
import { generateLevel } from '../game/generator';
import { RNG } from '../core/rng';
import { SIM, type RoadKind } from '../game/config';
import type { LevelDef } from '../game/types';

interface World {
  terrain: Terrain;
  net: Network;
  demand: Demand;
  traffic: Traffic;
  kinds: RoadKind[];
}

function buildWorld(level: LevelDef): World {
  resetDistrictNames();
  const terrain = new Terrain(level.size).generate(level.seed, level.terrain);
  const net = new Network(terrain, level.size);
  const demand = new Demand(net);
  level.zones.forEach((z, i) => {
    const wx = z.x * level.size;
    const wy = z.y * level.size;
    terrain.ensureLand(wx, wy, 62);
    demand.add(wx, wy, z.kind, { weight: z.weight ?? 1, colorIdx: z.color ?? i });
  });
  demand.rebuildMatrix();
  demand.updateAnchors();
  const traffic = new Traffic(net, demand, level.seed);
  const kinds: RoadKind[] = ['street'];
  if (level.tools?.avenue) kinds.push('avenue');
  if (level.tools?.highway) kinds.push('highway');
  return { terrain, net, demand, traffic, kinds };
}

interface Mark {
  t: number;
  delivered: number;
  jam: number;
  cars: number;
  money: number;
  spent: number;
  commute: number;
}

interface BotRun {
  level: LevelDef;
  baseCost: number;
  budget: number;
  marks: Mark[];
  gridlockAt: number;
  peakCars: number;
  peakJam: number;
  spent: number;
  earned: number;
  delivered: number;
  avgCommute: number;
  lost: number;
  edges: number;
  roadLen: number;
}

/** Cheapest possible "connect everyone" network — the reference for budgets. */
function baseConnectCost(level: LevelDef): number {
  const w = buildWorld(level);
  const rng = new RNG(level.seed + '-base');
  autoConnect(w.net, w.demand.zones, Infinity, rng, ['street'], { connectOnly: true });
  return w.net.stats().cost;
}

function botPlay(level: LevelDef, seconds: number, budget: number, marksAt: number[]): BotRun {
  const w = buildWorld(level);
  const rng = new RNG(level.seed + '-bot');
  const { net, demand, traffic, kinds } = w;

  let money = budget;
  let spent = 0;
  let earned = 0;
  traffic.hooks.onDeliver = (_car, fare) => {
    earned += fare;
    money += fare;
  };

  const marks: Mark[] = [];
  const markSet = new Set(marksAt);
  let nextPlan = 0;
  let t = 0;
  let gridlockAt = 0;

  const ramp = level.demand ?? { start: 0.6, end: 1, rampEnd: 90 };
  const plan = () => {
    if (money < 120) return;
    const before = net.stats().cost;
    const res = autoConnect(net, demand.zones, money, rng, kinds);
    const after = net.stats().cost;
    const delta = Math.max(0, after - before);
    money -= delta;
    spent += delta;
    void res;
  };

  plan();

  while (t < seconds) {
    demand.tick(SIM.dt, t, ramp);
    traffic.update(SIM.dt);
    t += SIM.dt;
    if (t >= nextPlan) {
      nextPlan = t + 10;
      plan();
    }
    const sec = Math.round(t);
    if (markSet.has(sec) && !marks.some((m) => m.t === sec)) {
      marks.push({
        t: sec,
        delivered: traffic.stats.delivered,
        jam: +traffic.stats.jam.toFixed(2),
        cars: traffic.cars.length,
        money: Math.round(money),
        spent: Math.round(spent),
        commute: +traffic.totalCommute().toFixed(1),
      });
    }
    if (level.goal.jamFails && traffic.stats.jam >= 1) {
      gridlockAt = t;
      break;
    }
  }

  const st = net.stats();
  return {
    level,
    baseCost: 0,
    budget,
    marks,
    gridlockAt: Math.round(gridlockAt),
    peakCars: traffic.stats.peakCars,
    peakJam: +traffic.stats.peakJam.toFixed(2),
    spent: Math.round(spent),
    earned: Math.round(earned),
    delivered: traffic.stats.delivered,
    avgCommute: +traffic.totalCommute().toFixed(1),
    lost: traffic.stats.lost,
    edges: st.edges,
    roadLen: Math.round(st.length),
  };
}

// --------------------------------------------------------------------- report

const args = process.argv.slice(2);
const calibrate = args.includes('--calibrate');
const wanted = args.filter((a) => !a.startsWith('-'));
const MARKS = [60, 100, 120, 150, 180, 210, 240, 300];

/** How long a level should take a competent player, by district count. */
function targetTime(zoneCount: number): number {
  return zoneCount <= 3 ? 100 : zoneCount <= 6 ? 150 : zoneCount <= 9 ? 210 : 240;
}

function line(r: BotRun, base: number): string {
  const at = (t: number) => r.marks.find((m) => m.t === t);
  const d240 = at(240)?.delivered ?? r.delivered;
  return [
    r.level.id.padEnd(4),
    r.level.name.slice(0, 18).padEnd(18),
    String(r.level.zones.length).padStart(2),
    `base ${String(Math.round(base)).padStart(6)}`,
    `bud ${String(r.budget).padStart(6)}`,
    `spent ${String(r.spent).padStart(6)}`,
    `earn ${String(r.earned).padStart(5)}`,
    `d60 ${String(at(60)?.delivered ?? 0).padStart(4)}`,
    `d${targetTime(r.level.zones.length)} ${String(d240).padStart(4)}`,
    `fin ${String(r.delivered).padStart(4)}`,
    `cars ${String(r.peakCars).padStart(4)}`,
    `jam ${r.peakJam.toFixed(2).padStart(4)}`,
    `com ${r.avgCommute.toFixed(1).padStart(5)}`,
    `lost ${String(r.lost).padStart(3)}`,
    r.gridlockAt ? `GRIDLOCK@${r.gridlockAt}s` : '',
  ]
    .filter((x) => x !== '')
    .join(' ');
}

/** Early levels must be affordable up front; later ones are earned as you go. */
export function budgetFor(baseCost: number, zoneCount: number): number {
  const f = zoneCount <= 3 ? 1.15 : zoneCount <= 5 ? 0.95 : zoneCount <= 7 ? 0.82 : zoneCount <= 10 ? 0.72 : 0.64;
  return Math.max(700, Math.round((baseCost * f) / 25) * 25);
}

function run(list: LevelDef[]): BotRun[] {
  const out: BotRun[] = [];
  for (const level of list) {
    const base = baseConnectCost(level);
    const budget = budgetFor(base, level.zones.length);
    const r = botPlay({ ...level, goal: { ...level.goal, deliver: 1e9 } }, 300, Math.max(600, budget), MARKS);
    r.baseCost = base;
    out.push(r);
    if (!calibrate) console.log(line(r, base));
  }
  return out;
}

if (wanted.includes('endless') || args.includes('endless')) {
  for (let d = 0; d <= 12; d += 2) {
    const lvl = generateLevel({ mode: 'endless', seed: 'BOT' + d, difficulty: d });
    const base = baseConnectCost(lvl);
    const r = botPlay({ ...lvl, goal: { ...lvl.goal, deliver: 1e9 } }, 300, budgetFor(base, lvl.zones.length), MARKS);
    r.baseCost = base;
    console.log(`d${String(d).padStart(2)} ` + line(r, base));
  }
} else {
  const list = wanted.length ? LEVELS.filter((l) => wanted.includes(l.id)) : LEVELS;
  const started = Date.now();
  const runs = run(list);

  if (calibrate) {
    const entries = runs.map((r) => {
      const tt = targetTime(r.level.zones.length);
      const dRef = r.marks.find((m) => m.t === tt)?.delivered ?? 0;
      const ref = Math.max(dRef, r.gridlockAt ? r.delivered * 0.8 : 0);
      const budget = budgetFor(r.baseCost, r.level.zones.length);
      // never let a gridlocked bot shrink a level below a meaningful size
      const floor = r.level.zones.length * 16;
      const goal = Math.max(20, floor, Math.round((ref * 0.95) / 5) * 5);
      const commute = Math.max(8, Math.round(r.avgCommute * 1.25));
      const cost = Math.round(r.baseCost * 1.3);
      return `  '${r.level.id}': { budget: ${budget}, deliver: ${goal}, parCost: ${cost}, parCommute: ${commute} },`;
    });
    const file = `/**
 * AUTO-GENERATED balance data — do not edit by hand.
 * Regenerate with: npm run sim -- --calibrate
 *
 * budget   starting funds (about 62% of the cheapest full connection, so the
 *          rest has to be earned from fares)
 * deliver  goal: ~92% of what the reference bot delivers in 240 s
 * parCost  2-star spend, parCommute 3-star average commute (seconds)
 */
import type { BalanceRow } from './balance-types';

export const BALANCE: Record<string, BalanceRow> = {
${entries.join('\n')}
};
`;
    writeFileSync(new URL('../game/balance.ts', import.meta.url), file);
    console.log(`\nwrote src/game/balance.ts for ${runs.length} levels in ${((Date.now() - started) / 1000).toFixed(1)}s`);
  } else {
    const gridlock = runs.filter((r) => r.gridlockAt > 0);
    console.log(
      `\n${runs.length} levels in ${((Date.now() - started) / 1000).toFixed(1)}s | ` +
        `gridlock: ${gridlock.map((r) => `${r.level.id}@${r.gridlockAt}s`).join(', ') || 'none'}`,
    );
  }
}
