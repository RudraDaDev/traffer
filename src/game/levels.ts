/**
 * The hand-authored campaign: 36 levels across four chapters.
 *
 * All coordinates are fractional (0..1 of the map) so a level can be replayed
 * at any world size, and zones are pushed off water at load time so a level is
 * always solvable no matter how the terrain rolls.
 */

import type { LevelDef, TerrainSpec, ToolSpec, ZoneSpec } from './types';
import type { ZoneKind } from './config';
import { BALANCE } from './balance';

type Z = [number, number, ZoneKind, number?];

interface LvlOpts {
  size?: number;
  seed?: string;
  terrain?: TerrainSpec;
  tools?: ToolSpec;
  time?: number;
  jam?: boolean;
  par?: { cost?: number; commute?: number; time?: number };
  demand?: { start: number; end: number; rampEnd: number };
  tutorial?: string[];
  brief: string;
}

const T = { street: true, bridge: true, bulldoze: true };
const T_AV: ToolSpec = { ...T, avenue: true };
const T_FW: ToolSpec = { ...T_AV, highway: true };

function zones(list: Z[]): ZoneSpec[] {
  return list.map(([x, y, kind, w]) => ({ x, y, kind, weight: w ?? 1 }));
}

function L(
  id: string,
  chapter: number,
  name: string,
  budget: number,
  deliver: number,
  list: Z[],
  o: LvlOpts,
): LevelDef {
  return {
    id,
    name,
    chapter,
    size: o.size ?? 900,
    seed: o.seed ?? id,
    terrain: o.terrain ?? {},
    zones: zones(list),
    goal: { deliver, budget, time: o.time ?? 0, jamFails: o.jam ?? false },
    par: o.par,
    tools: o.tools ?? T,
    demand: o.demand ?? { start: 0.6, end: 1, rampEnd: 90 },
    brief: o.brief,
    tutorial: o.tutorial,
    mode: 'campaign',
  };
}

export const LEVELS: LevelDef[] = [
  // ────────────────────────────────────────────────── Chapter 0 · Greenfield
  L('g1', 0, 'First Light', 1400, 12, [[0.24, 0.52, 'R'], [0.74, 0.46, 'C']], {
    size: 820,
    terrain: { forest: 0.12, rock: 0.02 },
    brief: 'One road. Two districts. Drag from the green homes to the blue offices.',
    tutorial: ['draw', 'deliver', 'tools'],
    par: { cost: 700, commute: 26 },
  }),
  L('g2', 0, 'Two of a Kind', 1900, 20, [[0.2, 0.3, 'R'], [0.5, 0.72, 'C'], [0.8, 0.34, 'R']], {
    size: 860,
    terrain: { forest: 0.22 },
    brief: 'Commuters travel both ways. A junction is cheaper than two separate roads.',
    tutorial: ['junction', 'budget'],
    par: { cost: 1100, commute: 30 },
  }),
  L('g3', 0, 'The Crossroads', 2400, 30, [
    [0.18, 0.2, 'R'],
    [0.82, 0.22, 'C'],
    [0.2, 0.8, 'I'],
    [0.8, 0.78, 'R'],
  ], {
    size: 900,
    terrain: { forest: 0.24 },
    brief: 'Four districts, one crossing. Where you put the junction decides everything.',
    par: { cost: 1500, commute: 34 },
  }),
  L('g4', 0, 'Country Lanes', 2300, 36, [
    [0.14, 0.5, 'R'],
    [0.38, 0.18, 'C'],
    [0.62, 0.82, 'R'],
    [0.86, 0.44, 'I'],
  ], {
    size: 940,
    terrain: { forest: 0.5, rock: 0.14 },
    brief: 'Clearing forest and blasting rock costs extra. Route around where you can.',
    par: { cost: 1700, commute: 38 },
  }),
  L('g5', 0, 'Grid Plan', 3200, 48, [
    [0.18, 0.18, 'R'],
    [0.5, 0.18, 'C'],
    [0.82, 0.18, 'R'],
    [0.18, 0.82, 'I'],
    [0.5, 0.82, 'C'],
    [0.82, 0.82, 'R'],
  ], {
    size: 980,
    terrain: { forest: 0.2 },
    brief: 'A grid gives every commuter a second option when one street jams.',
    par: { cost: 2300, commute: 36 },
  }),
  L('g6', 0, 'Bottleneck', 3000, 55, [
    [0.12, 0.3, 'R', 1.2],
    [0.12, 0.7, 'R', 1.2],
    [0.88, 0.3, 'C'],
    [0.88, 0.7, 'I'],
  ], {
    size: 1000,
    tools: T_AV,
    terrain: { rock: 0.5, forest: 0.2, blocks: [[0.5, 0.14, 0.14], [0.5, 0.86, 0.14]] },
    brief: 'A rock spine splits the map. Avenues carry four lanes through the gap.',
    par: { cost: 2200, commute: 44 },
  }),
  L('g7', 0, 'Rush Hour', 3400, 62, [
    [0.16, 0.16, 'R', 1.3],
    [0.5, 0.12, 'R'],
    [0.84, 0.2, 'R', 1.2],
    [0.5, 0.5, 'C', 1.5],
    [0.2, 0.84, 'I'],
    [0.8, 0.84, 'C'],
  ], {
    size: 1020,
    tools: T_AV,
    jam: true,
    terrain: { forest: 0.24, urban: [[0.5, 0.5, 0.14]] },
    brief: 'The jam meter is live now. Gridlock ends the level — keep traffic moving.',
    par: { cost: 2600, commute: 40 },
  }),
  L('g8', 0, 'Ring Road', 3800, 74, [
    [0.5, 0.1, 'C'],
    [0.86, 0.3, 'R'],
    [0.86, 0.7, 'I'],
    [0.5, 0.9, 'R'],
    [0.14, 0.7, 'C'],
    [0.14, 0.3, 'R'],
    [0.5, 0.5, 'C', 1.6],
  ], {
    size: 1040,
    tools: T_AV,
    jam: true,
    terrain: { forest: 0.2, urban: [[0.5, 0.5, 0.12]] },
    brief: 'A ring lets traffic go around a jam instead of through it.',
    par: { cost: 3000, commute: 42 },
  }),
  L('g9', 0, 'Greenfield Finale', 4200, 92, [
    [0.12, 0.14, 'R'],
    [0.4, 0.1, 'C'],
    [0.7, 0.14, 'R'],
    [0.9, 0.44, 'I'],
    [0.72, 0.86, 'R'],
    [0.4, 0.9, 'C'],
    [0.12, 0.8, 'R'],
    [0.44, 0.5, 'C', 1.4],
  ], {
    size: 1080,
    tools: T_AV,
    jam: true,
    terrain: { forest: 0.3, rock: 0.12, urban: [[0.44, 0.5, 0.12]] },
    brief: 'Everything you have learned, on one map. Build it to last.',
    par: { cost: 3400, commute: 44 },
  }),

  // ─────────────────────────────────────────────────── Chapter 1 · River City
  L('r1', 1, 'Two Banks', 3000, 34, [
    [0.2, 0.3, 'R'],
    [0.2, 0.72, 'I'],
    [0.8, 0.3, 'C'],
    [0.8, 0.72, 'R'],
  ], {
    size: 980,
    tools: T_AV,
    jam: true,
    terrain: { rivers: 1, riverDir: 'v', riverWidth: 34, forest: 0.16 },
    brief: 'A river runs north-south. Bridges cost double, so pick your crossings.',
    par: { cost: 2300, commute: 46 },
  }),
  L('r2', 1, 'Ferry Landing', 3400, 48, [
    [0.14, 0.24, 'R'],
    [0.44, 0.12, 'C'],
    [0.84, 0.3, 'R'],
    [0.6, 0.86, 'I'],
    [0.18, 0.78, 'C'],
  ], {
    size: 1020,
    tools: T_AV,
    jam: true,
    terrain: { rivers: 1, riverDir: 'h', riverWidth: 30, lakes: 1, forest: 0.2 },
    brief: 'A river and a lake. Two crossings will do if you place them well.',
    par: { cost: 2600, commute: 48 },
  }),
  L('r3', 1, 'Delta', 4000, 62, [
    [0.12, 0.16, 'R'],
    [0.5, 0.1, 'C'],
    [0.88, 0.18, 'R'],
    [0.86, 0.84, 'I'],
    [0.5, 0.9, 'C'],
    [0.14, 0.82, 'R'],
  ], {
    size: 1060,
    tools: T_AV,
    jam: true,
    terrain: { rivers: 2, riverDir: 'd', riverWidth: 26, forest: 0.16 },
    brief: 'Two rivers cross the map. The land between them is worth holding.',
    par: { cost: 3100, commute: 50 },
  }),
  L('r4', 1, 'South Quay', 4200, 68, [
    [0.14, 0.2, 'R'],
    [0.42, 0.44, 'C', 1.3],
    [0.78, 0.2, 'R'],
    [0.82, 0.78, 'I'],
    [0.2, 0.82, 'R'],
    [0.5, 0.9, 'C'],
  ], {
    size: 1080,
    tools: T_AV,
    jam: true,
    terrain: { sea: 0.2, lakes: 2, forest: 0.1, coast: 's' },
    brief: 'Water everywhere. Every bridge you build is a decision you cannot undo cheaply.',
    par: { cost: 3400, commute: 52 },
  }),
  L('r5', 1, 'Bridge Toll', 3200, 66, [
    [0.1, 0.5, 'R', 1.4],
    [0.34, 0.16, 'R'],
    [0.34, 0.84, 'I'],
    [0.68, 0.3, 'C', 1.3],
    [0.9, 0.7, 'R'],
  ], {
    size: 1040,
    tools: T_AV,
    jam: true,
    terrain: { rivers: 2, riverDir: 'v', riverWidth: 40, forest: 0.14 },
    brief: 'A tight purse and two wide rivers. One good bridge beats three cheap ones.',
    par: { cost: 2900, commute: 50 },
  }),
  L('r6', 1, 'Meander', 4400, 84, [
    [0.12, 0.3, 'R'],
    [0.3, 0.12, 'C'],
    [0.62, 0.16, 'R'],
    [0.88, 0.42, 'I'],
    [0.7, 0.86, 'R'],
    [0.36, 0.78, 'C'],
    [0.1, 0.62, 'R'],
  ], {
    size: 1100,
    tools: T_AV,
    jam: true,
    terrain: { rivers: 1, riverDir: 'h', riverWidth: 30, forest: 0.3, rock: 0.1 },
    brief: 'The river wanders. Follow the land, not the water.',
    par: { cost: 3500, commute: 54 },
  }),
  L('r7', 1, 'Locks and Canals', 5000, 98, [
    [0.1, 0.14, 'R'],
    [0.4, 0.1, 'C'],
    [0.72, 0.14, 'R'],
    [0.92, 0.5, 'I', 1.2],
    [0.7, 0.88, 'R'],
    [0.4, 0.92, 'C'],
    [0.1, 0.86, 'R'],
    [0.44, 0.5, 'C', 1.5],
  ], {
    size: 1120,
    tools: T_AV,
    jam: true,
    terrain: { rivers: 1, riverDir: 'v', riverWidth: 28, urban: [[0.44, 0.5, 0.16]], forest: 0.14 },
    brief: 'A city grew on both banks. The centre needs avenues, the banks need bridges.',
    par: { cost: 4100, commute: 50 },
  }),
  L('r8', 1, 'Flood Plain', 5200, 112, [
    [0.08, 0.3, 'R'],
    [0.3, 0.1, 'C'],
    [0.56, 0.28, 'R'],
    [0.86, 0.12, 'I'],
    [0.92, 0.62, 'R'],
    [0.64, 0.88, 'C'],
    [0.34, 0.72, 'R'],
    [0.1, 0.88, 'I'],
  ], {
    size: 1140,
    tools: T_AV,
    jam: true,
    terrain: { sea: 0.1, lakes: 3, rivers: 1, riverWidth: 22, forest: 0.18 },
    brief: 'Lakes everywhere and only dry ground to build on. Plan before you pave.',
    par: { cost: 4400, commute: 56 },
  }),
  L('r9', 1, 'River City Finale', 6000, 140, [
    [0.08, 0.16, 'R'],
    [0.34, 0.08, 'C'],
    [0.64, 0.12, 'R'],
    [0.9, 0.28, 'I'],
    [0.92, 0.66, 'R'],
    [0.68, 0.92, 'C'],
    [0.36, 0.9, 'R'],
    [0.08, 0.7, 'I'],
    [0.5, 0.5, 'C', 1.6],
  ], {
    size: 1180,
    tools: T_AV,
    jam: true,
    terrain: { rivers: 2, riverDir: 'any', riverWidth: 30, urban: [[0.5, 0.5, 0.14]], forest: 0.16 },
    brief: 'Two rivers, nine districts, one budget. This is the city you will be judged on.',
    par: { cost: 5000, commute: 54 },
  }),

  // ───────────────────────────────────────────────────── Chapter 2 · Downtown
  L('d1', 2, 'Old Town', 4200, 96, [
    [0.16, 0.2, 'R'],
    [0.5, 0.12, 'R'],
    [0.84, 0.24, 'R'],
    [0.5, 0.5, 'C', 1.8],
    [0.2, 0.82, 'I'],
    [0.8, 0.82, 'C'],
  ], {
    size: 1000,
    tools: T_AV,
    jam: true,
    terrain: { urban: [[0.5, 0.5, 0.2]], blocks: [[0.32, 0.34, 0.07], [0.68, 0.34, 0.07], [0.32, 0.66, 0.07], [0.68, 0.66, 0.07]] },
    brief: 'Dense blocks choke the centre. Feed it with avenues, not alleys.',
    par: { cost: 3600, commute: 46 },
  }),
  L('d2', 2, 'Midtown Grid', 4800, 116, [
    [0.14, 0.14, 'R'],
    [0.5, 0.14, 'C'],
    [0.86, 0.14, 'R'],
    [0.14, 0.5, 'I'],
    [0.86, 0.5, 'C'],
    [0.14, 0.86, 'R'],
    [0.5, 0.86, 'C'],
    [0.86, 0.86, 'R'],
  ], {
    size: 1040,
    tools: T_AV,
    jam: true,
    terrain: { urban: [[0.5, 0.5, 0.26]], forest: 0.05 },
    brief: 'Eight districts on a plain grid. Redundancy is the whole game.',
    par: { cost: 4000, commute: 44 },
  }),
  L('d3', 2, 'The Commute', 5000, 132, [
    [0.08, 0.14, 'R', 1.3],
    [0.26, 0.08, 'R', 1.2],
    [0.1, 0.5, 'R', 1.2],
    [0.14, 0.86, 'R', 1.3],
    [0.4, 0.92, 'R'],
    [0.72, 0.36, 'C', 1.8],
    [0.9, 0.62, 'C', 1.5],
    [0.66, 0.82, 'I', 1.2],
  ], {
    size: 1080,
    tools: T_AV,
    jam: true,
    terrain: { urban: [[0.78, 0.46, 0.2]], forest: 0.14 },
    brief: 'Everyone lives west, everyone works east. Expect a tidal wave each rush.',
    par: { cost: 4200, commute: 52 },
  }),
  L('d4', 2, 'Factory Row', 5200, 140, [
    [0.12, 0.22, 'R'],
    [0.12, 0.62, 'R'],
    [0.36, 0.88, 'R'],
    [0.56, 0.16, 'I', 1.5],
    [0.78, 0.34, 'I', 1.4],
    [0.88, 0.68, 'I', 1.3],
    [0.6, 0.6, 'C', 1.2],
  ], {
    size: 1080,
    tools: T_AV,
    jam: true,
    terrain: { rock: 0.3, urban: [[0.72, 0.44, 0.18]], forest: 0.1 },
    brief: 'Heavy industry on rough ground. Trucks do not like tight corners.',
    par: { cost: 4400, commute: 52 },
  }),
  L('d5', 2, 'Ring and Radial', 5600, 165, [
    [0.5, 0.08, 'C'],
    [0.82, 0.2, 'R'],
    [0.92, 0.52, 'I'],
    [0.8, 0.84, 'R'],
    [0.5, 0.92, 'C'],
    [0.2, 0.84, 'R'],
    [0.08, 0.52, 'I'],
    [0.2, 0.2, 'R'],
    [0.5, 0.5, 'C', 1.9],
  ], {
    size: 1120,
    tools: T_AV,
    jam: true,
    terrain: { urban: [[0.5, 0.5, 0.18]], forest: 0.14 },
    brief: 'A ring, eight spokes, one monster in the middle. Classic for a reason.',
    par: { cost: 4800, commute: 48 },
  }),
  L('d6', 2, 'Gridlock', 4600, 150, [
    [0.09, 0.28, 'R', 1.3],
    [0.09, 0.72, 'R', 1.3],
    [0.5, 0.09, 'C', 1.2],
    [0.5, 0.91, 'C', 1.2],
    [0.91, 0.28, 'I', 1.2],
    [0.91, 0.72, 'I', 1.2],
    [0.5, 0.5, 'C', 1.5],
    [0.3, 0.4, 'R'],
    [0.7, 0.62, 'R'],
  ], {
    size: 1140,
    tools: T_AV,
    jam: true,
    terrain: { urban: [[0.5, 0.5, 0.2]], forest: 0.06 },
    demand: { start: 0.5, end: 1.2, rampEnd: 170 },
    brief: 'Nine districts, little money, and a centre that never stops asking for more.',
    par: { cost: 4200, commute: 50 },
  }),
  L('d7', 2, 'Night Shift', 5400, 175, [
    [0.12, 0.12, 'I', 1.3],
    [0.44, 0.1, 'R'],
    [0.8, 0.14, 'I', 1.2],
    [0.9, 0.5, 'R'],
    [0.76, 0.88, 'C', 1.4],
    [0.42, 0.92, 'R'],
    [0.12, 0.86, 'C'],
    [0.1, 0.5, 'R'],
    [0.5, 0.5, 'I', 1.6],
  ], {
    size: 1140,
    tools: T_AV,
    jam: true,
    terrain: { urban: [[0.5, 0.5, 0.2]], rock: 0.14 },
    brief: 'Industry runs around the clock. Demand never dips, so neither can you.',
    par: { cost: 4600, commute: 50 },
  }),
  L('d8', 2, 'Density', 5800, 205, [
    [0.16, 0.16, 'R', 1.2],
    [0.42, 0.12, 'C', 1.2],
    [0.68, 0.16, 'R', 1.2],
    [0.88, 0.38, 'C', 1.2],
    [0.84, 0.66, 'R', 1.2],
    [0.6, 0.86, 'I', 1.2],
    [0.34, 0.86, 'C', 1.2],
    [0.12, 0.64, 'R', 1.2],
    [0.3, 0.4, 'C'],
    [0.62, 0.5, 'I'],
    [0.46, 0.66, 'R'],
  ], {
    size: 1060,
    tools: T_AV,
    jam: true,
    terrain: { urban: [[0.5, 0.5, 0.3]], forest: 0.02 },
    demand: { start: 0.8, end: 1.4, rampEnd: 150 },
    brief: 'Eleven districts crammed onto one small map. Every metre of asphalt counts.',
    par: { cost: 5000, commute: 46 },
  }),
  L('d9', 2, 'Downtown Finale', 6600, 235, [
    [0.08, 0.2, 'R', 1.3],
    [0.26, 0.08, 'C', 1.2],
    [0.56, 0.1, 'R', 1.2],
    [0.86, 0.14, 'I', 1.2],
    [0.94, 0.46, 'R', 1.2],
    [0.86, 0.8, 'C', 1.2],
    [0.56, 0.92, 'R', 1.2],
    [0.24, 0.9, 'I', 1.2],
    [0.06, 0.62, 'C', 1.2],
    [0.5, 0.5, 'C', 2],
    [0.32, 0.36, 'R'],
    [0.68, 0.64, 'I'],
  ], {
    size: 1180,
    tools: T_AV,
    jam: true,
    terrain: { urban: [[0.5, 0.5, 0.22]], rivers: 1, riverDir: 'd', riverWidth: 20, forest: 0.08 },
    demand: { start: 0.85, end: 1.45, rampEnd: 160 },
    brief: 'A river through downtown and twelve districts to serve. Earn your skyline.',
    par: { cost: 5800, commute: 52 },
  }),

  // ────────────────────────────────────────────────── Chapter 3 · Metropolis
  L('m1', 3, 'Bypass', 6200, 130, [
    [0.1, 0.5, 'R', 1.4],
    [0.32, 0.18, 'R'],
    [0.32, 0.82, 'R'],
    [0.62, 0.5, 'C', 1.6],
    [0.9, 0.24, 'I', 1.2],
    [0.9, 0.76, 'C'],
  ], {
    size: 1200,
    tools: T_FW,
    jam: true,
    terrain: { urban: [[0.62, 0.5, 0.12]], forest: 0.2 },
    brief: 'Arterials are unlocked. They fly over streets — end one on a street to make a ramp.',
    tutorial: ['highway'],
    par: { cost: 5000, commute: 52 },
  }),
  L('m2', 3, 'The Interchange', 7000, 165, [
    [0.08, 0.14, 'R', 1.2],
    [0.36, 0.08, 'R', 1.2],
    [0.7, 0.12, 'C', 1.2],
    [0.92, 0.36, 'R', 1.2],
    [0.88, 0.72, 'I', 1.2],
    [0.6, 0.92, 'R', 1.2],
    [0.26, 0.88, 'C', 1.2],
    [0.08, 0.6, 'R', 1.2],
    [0.5, 0.5, 'C', 1.8],
  ], {
    size: 1240,
    tools: T_FW,
    jam: true,
    terrain: { urban: [[0.5, 0.5, 0.16]], forest: 0.16, rock: 0.08 },
    brief: 'Where two arterials meet, you get an interchange. Where they meet streets, ramps.',
    par: { cost: 5800, commute: 50 },
  }),
  L('m3', 3, 'South Arterial', 7200, 195, [
    [0.12, 0.24, 'R', 1.2],
    [0.34, 0.12, 'C', 1.2],
    [0.6, 0.16, 'R', 1.2],
    [0.82, 0.24, 'I', 1.2],
    [0.9, 0.46, 'R'],
    [0.7, 0.56, 'C', 1.4],
    [0.44, 0.52, 'R', 1.2],
    [0.2, 0.56, 'I'],
    [0.5, 0.34, 'C', 1.3],
  ], {
    size: 1260,
    tools: T_FW,
    jam: true,
    terrain: { coast: 's', sea: 0.24, forest: 0.12, urban: [[0.5, 0.32, 0.18]] },
    brief: 'The waterfront takes the south edge. One arterial and a lot of on-ramps.',
    par: { cost: 6000, commute: 54 },
  }),
  L('m4', 3, 'Ramp Art', 6000, 200, [
    [0.1, 0.1, 'R', 1.3],
    [0.5, 0.08, 'R', 1.2],
    [0.9, 0.12, 'C', 1.3],
    [0.92, 0.5, 'I', 1.2],
    [0.86, 0.9, 'R', 1.2],
    [0.46, 0.92, 'C', 1.3],
    [0.08, 0.88, 'R', 1.2],
    [0.08, 0.48, 'I', 1.2],
    [0.5, 0.5, 'C', 1.8],
  ], {
    size: 1220,
    tools: T_FW,
    jam: true,
    terrain: { urban: [[0.5, 0.5, 0.16]], forest: 0.1 },
    demand: { start: 0.9, end: 1.35, rampEnd: 170 },
    brief: 'Little money, a big neighbourhood. An arterial spine with cheap street ramps is the answer.',
    par: { cost: 5400, commute: 52 },
  }),
  L('m5', 3, 'Sprawl', 8200, 245, [
    [0.06, 0.16, 'R'],
    [0.24, 0.06, 'C'],
    [0.46, 0.12, 'R'],
    [0.7, 0.06, 'I'],
    [0.92, 0.18, 'R'],
    [0.94, 0.46, 'C'],
    [0.88, 0.74, 'R'],
    [0.66, 0.94, 'I'],
    [0.42, 0.9, 'R'],
    [0.18, 0.94, 'C'],
    [0.06, 0.66, 'R'],
    [0.5, 0.5, 'C', 1.7],
  ], {
    size: 1360,
    tools: T_FW,
    jam: true,
    terrain: { forest: 0.24, lakes: 1, urban: [[0.5, 0.5, 0.14]] },
    brief: 'The neighbourhood just got big. Without an arterial you will never cross it in time.',
    par: { cost: 7000, commute: 62 },
  }),
  L('m6', 3, 'Cross City', 8000, 255, [
    [0.08, 0.12, 'R', 1.2],
    [0.32, 0.08, 'C', 1.2],
    [0.62, 0.1, 'R', 1.2],
    [0.9, 0.2, 'I', 1.2],
    [0.94, 0.56, 'R', 1.2],
    [0.78, 0.9, 'C', 1.2],
    [0.46, 0.94, 'R', 1.2],
    [0.16, 0.88, 'I', 1.2],
    [0.06, 0.54, 'C', 1.2],
    [0.5, 0.5, 'C', 1.8],
    [0.3, 0.34, 'R'],
  ], {
    size: 1300,
    tools: T_FW,
    jam: true,
    terrain: { rivers: 1, riverDir: 'v', riverWidth: 44, urban: [[0.5, 0.5, 0.16]], forest: 0.12 },
    demand: { start: 0.85, end: 1.4, rampEnd: 180 },
    brief: 'A canal through the middle and eleven districts. Bridge it with the arterial.',
    par: { cost: 7000, commute: 56 },
  }),
  L('m7', 3, 'Megalopolis', 9000, 300, [
    [0.06, 0.1, 'R', 1.2],
    [0.26, 0.06, 'C', 1.2],
    [0.5, 0.08, 'R', 1.2],
    [0.74, 0.06, 'I', 1.2],
    [0.94, 0.14, 'R', 1.2],
    [0.96, 0.44, 'C', 1.2],
    [0.92, 0.74, 'R', 1.2],
    [0.7, 0.94, 'I', 1.2],
    [0.44, 0.96, 'R', 1.2],
    [0.18, 0.92, 'C', 1.2],
    [0.04, 0.7, 'R', 1.2],
    [0.05, 0.4, 'I', 1.2],
    [0.5, 0.5, 'C', 2],
  ], {
    size: 1400,
    tools: T_FW,
    jam: true,
    terrain: { urban: [[0.5, 0.5, 0.2]], forest: 0.14, rock: 0.08 },
    demand: { start: 0.9, end: 1.4, rampEnd: 200 },
    brief: 'Thirteen districts, one mega-core. Build the network you would defend.',
    par: { cost: 7800, commute: 58 },
  }),
  L('m8', 3, 'Last Exit', 8600, 330, [
    [0.08, 0.14, 'R', 1.3],
    [0.3, 0.08, 'R', 1.2],
    [0.56, 0.12, 'C', 1.3],
    [0.84, 0.1, 'R', 1.2],
    [0.94, 0.38, 'I', 1.3],
    [0.9, 0.68, 'R', 1.2],
    [0.68, 0.9, 'C', 1.3],
    [0.4, 0.94, 'R', 1.2],
    [0.14, 0.86, 'I', 1.2],
    [0.06, 0.56, 'C', 1.3],
    [0.38, 0.4, 'R'],
    [0.62, 0.6, 'I'],
    [0.5, 0.5, 'C', 1.8],
  ], {
    size: 1380,
    tools: T_FW,
    jam: true,
    terrain: { rivers: 2, riverDir: 'any', riverWidth: 30, urban: [[0.5, 0.5, 0.18]], forest: 0.1 },
    demand: { start: 1, end: 1.5, rampEnd: 200 },
    brief: 'Thirteen districts, two rivers, relentless demand. The last exit is yours.',
    par: { cost: 7800, commute: 56 },
  }),
  L('m9', 3, 'Traffer', 10000, 400, [
    [0.05, 0.08, 'R', 1.3],
    [0.22, 0.05, 'C', 1.3],
    [0.44, 0.06, 'R', 1.2],
    [0.66, 0.05, 'I', 1.3],
    [0.88, 0.08, 'R', 1.2],
    [0.96, 0.3, 'C', 1.3],
    [0.97, 0.56, 'R', 1.2],
    [0.88, 0.82, 'I', 1.3],
    [0.66, 0.95, 'R', 1.2],
    [0.44, 0.96, 'C', 1.3],
    [0.2, 0.93, 'R', 1.2],
    [0.05, 0.78, 'I', 1.3],
    [0.04, 0.5, 'C', 1.2],
    [0.06, 0.26, 'R', 1.2],
    [0.5, 0.5, 'C', 2.2],
    [0.34, 0.36, 'R'],
    [0.66, 0.64, 'I'],
  ], {
    size: 1500,
    tools: T_FW,
    jam: true,
    terrain: { rivers: 2, riverDir: 'any', riverWidth: 34, lakes: 1, urban: [[0.5, 0.5, 0.2]], forest: 0.12 },
    demand: { start: 0.9, end: 1.5, rampEnd: 240 },
    brief: 'Seventeen districts. The whole map. This is why you played the others.',
    par: { cost: 9000, commute: 62 },
  }),
];

/**
 * Budgets, goals and star pars come from the measured balance table (see
 * src/tools/simtest.ts). The literals above are the design fallbacks and are
 * used whenever a level has no measured row yet.
 */
for (const l of LEVELS) {
  const b = BALANCE[l.id];
  if (!b) continue;
  l.goal.budget = b.budget;
  l.goal.deliver = b.deliver;
  l.par = { cost: b.parCost, commute: b.parCommute };
}

export const LEVEL_BY_ID = new Map(LEVELS.map((l) => [l.id, l]));

export function levelsForChapter(chapter: number): LevelDef[] {
  return LEVELS.filter((l) => l.chapter === chapter);
}

export function levelIndex(id: string): number {
  return LEVELS.findIndex((l) => l.id === id);
}

export function nextLevel(id: string): LevelDef | null {
  const i = levelIndex(id);
  return i >= 0 && i + 1 < LEVELS.length ? LEVELS[i + 1] : null;
}

export function prevLevel(id: string): LevelDef | null {
  const i = levelIndex(id);
  return i > 0 ? LEVELS[i - 1] : null;
}

/** A level is open if it is the first, or the previous one earned at least 1 star. */
export function isLevelUnlocked(id: string, completed: Record<string, { stars: number }>): boolean {
  const i = levelIndex(id);
  if (i <= 0) return true;
  const prev = LEVELS[i - 1];
  return (completed[prev.id]?.stars ?? 0) >= 1;
}
