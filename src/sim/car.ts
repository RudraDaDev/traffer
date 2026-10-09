/** A commuter. Kept as a flat mutable object for cache-friendly simulation. */

import type { Edge } from '../net/network';

export interface PathStep {
  /** edge id */
  e: number;
  /** +1 = travel a->b, -1 = travel b->a */
  d: 1 | -1;
}

export interface Car {
  id: number;
  fromZone: number;
  toZone: number;
  colorIdx: number;
  /** current edge, or null while (re)routing */
  edge: Edge | null;
  dir: 1 | -1;
  /** arc-length progress along the edge in the travel direction */
  t: number;
  speed: number;
  /** world position, updated every step (used for rendering + effects) */
  x: number;
  y: number;
  a: number;
  path: PathStep[];
  pathIdx: number;
  /** seconds spent crawling */
  wait: number;
  /** total trip time */
  tripTime: number;
  /** planned trip length in world units (for fare + stats) */
  tripDist: number;
  /** distance actually driven */
  driven: number;
  stuck: boolean;
  needsPath: boolean;
  nextRepath: number;
  alive: boolean;
  /** per-lane offset in world units, for visual variety */
  laneOff: number;
  honked: boolean;
}

let nextCarId = 1;

export function makeCar(fromZone: number, toZone: number, colorIdx: number): Car {
  return {
    id: nextCarId++,
    fromZone,
    toZone,
    colorIdx,
    edge: null,
    dir: 1,
    t: 0,
    speed: 0,
    x: 0,
    y: 0,
    a: 0,
    path: [],
    pathIdx: 0,
    wait: 0,
    tripTime: 0,
    tripDist: 0,
    driven: 0,
    stuck: false,
    needsPath: true,
    nextRepath: 0,
    alive: true,
    laneOff: 0,
    honked: false,
  };
}

export function resetCarIds(): void {
  nextCarId = 1;
}
