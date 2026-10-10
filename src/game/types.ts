/** Shared domain types: levels, goals, results, settings, saves. */

import type { GameMode, RoadKind, ZoneKind } from './config';

/** A water body / obstacle descriptor used by the terrain generator. */
export interface TerrainSpec {
  /** 0..1 — how much of the map is below sea level */
  sea?: number;
  /** number of rivers to carve */
  rivers?: number;
  riverWidth?: number;
  /** 'h' | 'v' | 'd' | 'any' — preferred river direction */
  riverDir?: 'h' | 'v' | 'd' | 'any';
  lakes?: number;
  forest?: number;
  rock?: number;
  /** pre-placed urban ground patches, fractional coords [[x,y,r], ...] */
  urban?: [number, number, number][];
  /** bay / coastline along one edge */
  coast?: 'none' | 'n' | 's' | 'e' | 'w';
  /** how hard the map border pushes land down: island = ring of sea */
  border?: 'none' | 'soft' | 'island';
  /** forbid building inside these fractional circles [[x,y,r], ...] */
  blocks?: [number, number, number][];
}

/** A district (origin/destination) placed on the map, in fractional coords. */
export interface ZoneSpec {
  x: number;
  y: number;
  kind: ZoneKind;
  /** relative traffic demand (spawn rate multiplier) */
  weight?: number;
  /** index into DISTRICT_COLORS; auto-assigned when omitted */
  color?: number;
  name?: string;
}

export interface GoalSpec {
  /** deliver this many commuters */
  deliver: number;
  /** seconds allowed; 0 = no limit */
  time?: number;
  /** fail if the jam meter fills */
  jamFails?: boolean;
  /** budget */
  budget: number;
}

/** Star thresholds — all optional; missing ones are simply not graded. */
export interface ParSpec {
  /** spend no more than this */
  cost?: number;
  /** average commute no longer than this (seconds) */
  commute?: number;
  /** finish within this many seconds */
  time?: number;
}

export interface ToolSpec {
  street?: boolean;
  avenue?: boolean;
  highway?: boolean;
  bridge?: boolean;
  zone?: boolean;
  bulldoze?: boolean;
}

export interface LevelDef {
  id: string;
  name: string;
  chapter: number;
  /** world size in units (square) */
  size: number;
  seed: string;
  terrain: TerrainSpec;
  zones: ZoneSpec[];
  goal: GoalSpec;
  par?: ParSpec;
  tools?: ToolSpec;
  /** demand ramp: cars/sec per zone at t=0 and at t=rampEnd */
  demand?: { start: number; end: number; rampEnd: number };
  brief: string;
  /** tutorial step ids that fire during this level */
  tutorial?: string[];
  mode?: GameMode;
  /** endless only: how hard the ramp is */
  difficulty?: number;
}

export interface ChapterDef {
  index: number;
  name: string;
  subtitle: string;
  color: string;
}

export const CHAPTERS: ChapterDef[] = [
  { index: 0, name: 'Neighbourhood', subtitle: 'Learn the streets', color: '#5ad07a' },
  { index: 1, name: 'Canals', subtitle: 'Water in the way', color: '#4aa8ff' },
  { index: 2, name: 'Downtown', subtitle: 'Density bites back', color: '#ffb020' },
  { index: 3, name: 'Junctions', subtitle: 'Arterials and ramps', color: '#ff6b8b' },
];

export interface LevelResult {
  won: boolean;
  reason: 'goal' | 'gridlock' | 'timeout' | 'quit' | 'sandbox';
  delivered: number;
  goal: number;
  stars: number;
  cost: number;
  earned: number;
  time: number;
  avgCommute: number;
  bestCombo: number;
  roadsBuilt: number;
  roadLength: number;
  peakCars: number;
  peakJam: number;
  score: number;
}

export interface LevelProgress {
  /** best stars earned */
  stars: number;
  bestScore: number;
  bestTime: number;
  lowestCost: number;
  completed: number;
}

export interface ProgressData {
  campaign: Record<string, LevelProgress>;
  unlockedChapter: number;
  totalStars: number;
  tutorialDone: boolean;
  seenHelp: boolean;
  /** last campaign level played, for the Continue button */
  lastLevel: string;
}

export interface StatsData {
  delivered: number;
  roadsBuilt: number;
  roadLength: number;
  moneySpent: number;
  moneyEarned: number;
  playTime: number;
  levelsCompleted: number;
  levelsFailed: number;
  endlessBest: number;
  dailyStreak: number;
  dailyLast: string;
  jams: number;
}

export interface EndlessRecord {
  seed: string;
  score: number;
  delivered: number;
  time: number;
  difficulty: number;
  date: number;
}

export interface Settings {
  sfx: number;
  music: number;
  muted: boolean;
  gridSnap: boolean;
  angleSnap: boolean;
  leftHanded: boolean;
  reduceMotion: boolean;
  colorBlind: boolean;
  showFps: boolean;
  dayNight: boolean;
  quality: 'auto' | 'high' | 'low';
  haptics: boolean;
}

export const defaultSettings: Settings = {
  sfx: 0.8,
  music: 0.4,
  muted: false,
  gridSnap: true,
  angleSnap: true,
  leftHanded: false,
  reduceMotion: false,
  colorBlind: false,
  showFps: false,
  dayNight: true,
  quality: 'auto',
  haptics: true,
};

export const defaultProgress = (): ProgressData => ({
  campaign: {},
  unlockedChapter: 0,
  totalStars: 0,
  tutorialDone: false,
  seenHelp: false,
  lastLevel: '',
});

export const defaultStats = (): StatsData => ({
  delivered: 0,
  roadsBuilt: 0,
  roadLength: 0,
  moneySpent: 0,
  moneyEarned: 0,
  playTime: 0,
  levelsCompleted: 0,
  levelsFailed: 0,
  endlessBest: 0,
  dailyStreak: 0,
  dailyLast: '',
  jams: 0,
});

/** Serialised sandbox world (network + zones + camera). */
export interface SandboxSave {
  id: string;
  name: string;
  seed: string;
  size: number;
  savedAt: number;
  money: number;
  delivered: number;
  nodes: { id: number; x: number; y: number }[];
  edges: { id: number; a: number; b: number; k: RoadKind; pts: [number, number][]; br?: boolean; cost?: number }[];
  zones: { x: number; y: number; kind: ZoneKind; color: number; name?: string }[];
  camera?: { x: number; y: number; zoom: number };
}

export const ALL_TOOLS: ToolSpec = {
  street: true,
  avenue: true,
  highway: true,
  bridge: true,
  zone: true,
  bulldoze: true,
};
