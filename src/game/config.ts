/** Central tuning + theme constants. Everything the design touches lives here. */

export type RoadKind = 'street' | 'avenue' | 'highway';
export type ToolId = 'street' | 'avenue' | 'highway' | 'bulldoze' | 'zone' | 'inspect';
export type ZoneKind = 'R' | 'C' | 'I';
export type GameMode = 'campaign' | 'endless' | 'daily' | 'sandbox';

export interface RoadSpec {
  id: RoadKind;
  name: string;
  short: string;
  /** total lanes (both directions) */
  lanes: number;
  /** visual width in world units */
  width: number;
  /** free-flow speed, world units / second */
  speed: number;
  /** base cost per world unit */
  cost: number;
  /** seconds to pave one unit (build animation only) */
  gradeSeparated: boolean;
  /** can cross water */
  bridge: boolean;
  desc: string;
}

export const ROADS: Record<RoadKind, RoadSpec> = {
  street: {
    id: 'street',
    name: 'Street',
    short: 'ST',
    lanes: 2,
    width: 11,
    speed: 40,
    cost: 3.2,
    gradeSeparated: false,
    bridge: true,
    desc: 'Two lanes, connects to everything. Cheap and flexible.',
  },
  avenue: {
    id: 'avenue',
    name: 'Avenue',
    short: 'AV',
    lanes: 4,
    width: 19,
    speed: 54,
    cost: 7.4,
    gradeSeparated: false,
    bridge: true,
    desc: 'Four lanes of capacity for busy corridors.',
  },
  highway: {
    id: 'highway',
    name: 'Freeway',
    short: 'FW',
    lanes: 6,
    width: 27,
    speed: 92,
    cost: 16,
    gradeSeparated: true,
    bridge: true,
    desc: 'Grade-separated: it flies over streets. Connect it with ramps.',
  },
};

export const ROAD_ORDER: RoadKind[] = ['street', 'avenue', 'highway'];

/** Cars per lane are packed no tighter than this (world units, bumper to bumper). */
export const CAR_SPACING = 11.5;
export const CAR_LENGTH = 7.2;
export const CAR_WIDTH = 3.6;

/** Terrain build-cost multipliers. */
export const TERRAIN_COST: Record<number, number> = {
  0: 2.3, // deep water  -> bridge
  1: 2.3, // shallow water -> bridge
  2: 1.0, // sand
  3: 1.0, // grass
  4: 1.35, // forest
  5: 1.7, // rock
  6: 1.2, // urban
};

export const TERRAIN_NAMES = ['Deep water', 'Water', 'Sand', 'Grass', 'Forest', 'Rock', 'City ground'];

export const SIM = {
  /** fixed simulation step */
  dt: 1 / 60,
  /** never run more than this many catch-up steps in one frame */
  maxStepsPerFrame: 3,
  /** speed multiplier options */
  speeds: [0, 1, 2, 3] as const,
  /** a car below this speed counts as "waiting" */
  crawlSpeed: 7,
  /** seconds of crawling before a car is counted as stuck */
  stuckAfter: 6,
  /** jam meter fill rate at full gridlock (per second) */
  jamFill: 0.075,
  /** jam meter drain when traffic flows (per second) */
  jamDrain: 0.09,
  /** severity (0..1) above which the jam meter starts filling */
  jamThreshold: 0.35,
  /** seconds of level time before the jam meter can move at all */
  jamGrace: 22,
  /** repath check interval per car (seconds) */
  repathInterval: 1.6,
  /** how much congestion inflates path cost */
  congestionWeight: 3.2,
  /** cars only reroute if the new path is this much cheaper */
  rerouteGain: 0.22,
  /** max cars alive at once (perf guard) */
  maxCars: 1400,
  /** how strongly junctions slow traffic down */
  junctionPenalty: 0.32,
};

export const ECONOMY = {
  /** base fare paid when a commuter reaches their destination */
  baseFare: 1.6,
  /** fare earned per world unit travelled */
  farePerUnit: 0.0062,
  /** refund fraction when bulldozing */
  refund: 0.35,
  /** bridge cost multiplier is in TERRAIN_COST; this is the flat surcharge */
  bridgeSurcharge: 26,
};

export const BUILD = {
  /** snap to an existing node within this distance */
  nodeSnap: 26,
  /** snap onto an existing edge within this distance */
  edgeSnap: 16,
  /** grid size when grid snap is on */
  grid: 20,
  /** grid snap strength */
  gridSnap: 9,
  /** minimum segment length after simplification */
  minSegment: 26,
  /** RDP tolerance while simplifying a freehand stroke */
  simplifyTolerance: 3.2,
  /** angle snap increments (radians) */
  angleStep: Math.PI / 4,
  /** angle snap tolerance (radians) */
  angleTolerance: 0.16,
  /** minimum total length of a road you can build */
  minLength: 16,
};

export const THEME = {
  bg: '#0b1015',
  panel: '#121b23',
  panelSoft: '#18242e',
  line: '#243441',
  text: '#e8eef2',
  textDim: '#93a7b6',
  accent: '#ffb020',
  accent2: '#4fd1c5',
  danger: '#ff5a4e',
  good: '#5ad07a',
  // road palette
  roadCasing: { street: '#26323c', avenue: '#2b3945', highway: '#33414d' },
  roadFill: { street: '#4c5f6e', avenue: '#5a7183', highway: '#7d90a1' },
  roadMark: { street: '#e8d9a0', avenue: '#f2e6b8', highway: '#ffffff' },
  water: ['#0d2a3d', '#123d57'],
  land: ['#2f4a33', '#3c5c3f'],
};

/** Colour per zone kind — also used for commuter liveries. */
export const ZONE_COLORS: Record<ZoneKind, string> = {
  R: '#5ad07a', // residential — green
  C: '#4aa8ff', // commercial — blue
  I: '#ffb020', // industrial — amber
};

export const ZONE_NAMES: Record<ZoneKind, string> = {
  R: 'Homes',
  C: 'Offices',
  I: 'Industry',
};

/** Extended palette for big maps where many districts must stay distinct. */
export const DISTRICT_COLORS = [
  '#5ad07a',
  '#4aa8ff',
  '#ffb020',
  '#ff6b8b',
  '#b47cff',
  '#3fd0d4',
  '#ff9f43',
  '#a3e635',
  '#f472b6',
  '#60a5fa',
];

export const VERSION = '1.0.0';
export const STORAGE_KEYS = {
  settings: 'settings',
  progress: 'progress',
  stats: 'stats',
  endless: 'endless',
  sandboxIndex: 'sandbox.index',
  sandboxSave: (id: string) => `sandbox.${id}`,
};
