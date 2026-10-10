/**
 * Traffic simulation.
 *
 * Link-based queue model with car-following: each edge knows how full it is,
 * which caps the speed of everything on it (Greenshields-style), and each car
 * keeps a constant-time gap to the leader. Junctions throttle approaching cars
 * by how contested they are, and a car will not enter a saturated next edge —
 * which is what makes queues spill back and gridlock emerge naturally.
 */

import { CAR_LENGTH, ECONOMY, ROADS, SIM, DISTRICT_COLORS } from '../game/config';
import { approach, clamp, clamp01, dist } from '../core/math';
import { findRoute } from '../net/path';
import { headingAtArc, pointAtArc, type Edge, type Network, type RNode } from '../net/network';
import { makeCar, type Car } from './car';
import type { Demand, Zone } from './demand';
import { RNG } from '../core/rng';

export interface TrafficStats {
  delivered: number;
  lost: number;
  cars: number;
  peakCars: number;
  commuteSum: number;
  avgCommute: number;
  combo: number;
  bestCombo: number;
  jam: number;
  peakJam: number;
  /** 0..1 instantaneous gridlock severity */
  severity: number;
  stuck: number;
  income: number;
  incomeWindow: number[];
  incomeRate: number;
  driven: number;
}

export interface TrafficHooks {
  onDeliver?: (car: Car, fare: number, combo: number, zone: Zone) => void;
  onLost?: (car: Car) => void;
  onHonk?: () => void;
  onJamWarn?: (level: number) => void;
}

const LOOKAHEAD = 140;
const ACCEL = 24;
const BRAKE = 62;
const HEADWAY = 0.5; // seconds of gap the driver wants
const MIN_GAP = 2.4; // bumper distance at a standstill

export class Traffic {
  net: Network;
  demand: Demand;
  cars: Car[] = [];
  stats: TrafficStats;
  hooks: TrafficHooks = {};
  private rng: RNG;
  private elapsed = 0;
  private lastWarn = 0;
  private slowClock = 0;
  private rerouteBudget = 0;
  maxCars = SIM.maxCars;

  constructor(net: Network, demand: Demand, seed: number | string = 'traffic') {
    this.net = net;
    this.demand = demand;
    this.rng = new RNG(seed);
    this.stats = this.blankStats();
  }

  private blankStats(): TrafficStats {
    return {
      delivered: 0,
      lost: 0,
      cars: 0,
      peakCars: 0,
      commuteSum: 0,
      avgCommute: 0,
      combo: 0,
      bestCombo: 0,
      jam: 0,
      peakJam: 0,
      severity: 0,
      stuck: 0,
      income: 0,
      incomeWindow: [],
      incomeRate: 0,
      driven: 0,
    };
  }

  reset(seed?: number | string): void {
    for (const c of this.cars) {
      if (c.edge) this.net.detachCar(c.edge, c);
      c.alive = false;
    }
    this.cars = [];
    for (const e of this.net.edges) {
      e.carsF.length = 0;
      e.carsB.length = 0;
      e.density = 0;
      e.congestion = 0;
      e.avgSpeed = e.freeSpeed;
      e.flow = 0;
    }
    for (const n of this.net.nodes) {
      n.pressure = 0;
      n.flow = 0;
    }
    this.stats = this.blankStats();
    this.elapsed = 0;
    if (seed !== undefined) this.rng = new RNG(seed);
  }

  get jam(): number {
    return this.stats.jam;
  }

  /**
   * Called after an undo/redo or a load: any commuter standing on road that no
   * longer exists is re-homed on the nearest surviving junction.
   */
  heal(): void {
    for (const car of this.cars) {
      const e = car.edge;
      if (!e || this.net.getEdge(e.id) !== e) {
        if (e) this.net.detachCar(e, car);
        car.edge = null;
        car.needsPath = true;
        car.nextRepath = 0;
        continue;
      }
      car.t = clamp(car.t, 0, e.len);
    }
    for (const e of this.net.edges) {
      e.carsF.sort((a, b) => a.t - b.t);
      e.carsB.sort((a, b) => a.t - b.t);
    }
  }

  // ------------------------------------------------------------------- update

  update(dt: number, opts: { spawn?: boolean } = {}): void {
    this.elapsed += dt;
    this.net.refreshState();
    this.rerouteBudget = 14;
    this.slowClock -= dt;
    if (this.slowClock <= 0) {
      this.slowClock = 0.5;
      this.demand.updateAnchors();
      this.demand.updateLinks();
    }

    if (opts.spawn !== false) this.spawnPhase();

    const cars = this.cars;
    for (let i = cars.length - 1; i >= 0; i--) {
      const car = cars[i];
      if (!car.alive) {
        cars.splice(i, 1);
        continue;
      }
      this.stepCar(car, dt);
      if (!car.alive) cars.splice(i, 1);
    }

    this.updateJam(dt);
    this.updateIncomeRate();

    const s = this.stats;
    s.cars = cars.length;
    if (cars.length > s.peakCars) s.peakCars = cars.length;
    let stuck = 0;
    let commute = 0;
    let n = 0;
    for (const c of cars) {
      if (c.stuck) stuck++;
      commute += c.tripTime;
      n++;
    }
    s.stuck = stuck;
    s.avgCommute = n ? commute / n : 0;
  }

  private spawnPhase(): void {
    for (const z of this.demand.zones) {
      if (!z.anchor) {
        z.spawnAcc = Math.min(z.spawnAcc, 0.9);
        continue;
      }
      let guard = 0;
      while (this.demand.consumeSpawn(z) && guard++ < 4) {
        if (this.cars.length >= this.maxCars) {
          z.spawnAcc = 0;
          break;
        }
        const dest = this.demand.pickDestination(z, this.rng);
        if (!dest || !dest.anchor) {
          // nowhere to go yet: the commuter stays home, no penalty
          continue;
        }
        this.spawn(z, dest);
      }
    }
  }

  private spawn(from: Zone, to: Zone): Car | null {
    if (!from.anchor || !to.anchor) return null;
    const route = findRoute(this.net, from.anchor, to.anchor);
    if (!route || !route.steps.length) return null;
    const first = this.net.getEdge(route.steps[0].e);
    if (!first) return null;
    const car = makeCar(from.id, to.id, to.colorIdx);
    car.path = route.steps;
    car.pathIdx = 0;
    car.tripDist = route.length;
    car.edge = first;
    car.dir = route.steps[0].d;
    car.t = car.dir === 1 ? 0.5 : Math.max(0.5, first.len - 0.5);
    car.laneOff = (this.rng.next() - 0.5) * 1.6;
    car.needsPath = false;
    car.nextRepath = this.elapsed + this.rng.float(0.4, SIM.repathInterval + 1.2);
    this.net.attachCar(first, car);
    this.syncPosition(car);
    from.spawned++;
    from.inTransit++;
    this.cars.push(car);
    return car;
  }

  // ------------------------------------------------------------------ per car

  private stepCar(car: Car, dt: number): void {
    const e = car.edge;
    if (!e || this.net.getEdge(e.id) !== e) {
      this.stranded(car, dt);
      return;
    }
    if (car.needsPath) {
      this.reroute(car);
      if (!car.edge) return;
    }

    let target = e.freeSpeed * densityFactor(e) * (0.5 + 0.5 * e.buildT);

    // ---- car following
    const list = car.dir === 1 ? e.carsF : e.carsB;
    const leader = findLeader(list, car);
    let gap = Infinity;
    if (leader) {
      gap = car.dir === 1 ? leader.t - car.t - CAR_LENGTH : car.t - leader.t - CAR_LENGTH;
      if (gap > LOOKAHEAD) gap = Infinity;
    }
    if (gap !== Infinity) {
      const v = Math.max(0, (gap - MIN_GAP) / HEADWAY);
      if (v < target) target = v;
    }

    // ---- junctions and blocking back
    const endId = car.dir === 1 ? e.b : e.a;
    const endNode = this.net.getNode(endId);
    const distToEnd = car.dir === 1 ? e.len - car.t : car.t;
    if (this.elapsed >= car.nextRepath && distToEnd < 70) {
      car.nextRepath = this.elapsed + SIM.repathInterval + this.rng.float(0, 1.4);
      if (this.rerouteBudget > 0) {
        this.rerouteBudget--;
        this.maybeReroute(car);
      }
    }
    if (endNode && distToEnd < 42) {
      if (endNode.edges.length >= 3) {
        const contested = clamp01((endNode.edges.length - 2) / 3);
        target *= 1 - SIM.junctionPenalty * endNode.pressure * contested * clamp01(distToEnd / 42 + 0.25);
      }
      const next = this.peekNextEdge(car, endNode);
      if (next) {
        if (next.congestion > 0.9) {
          // do not enter a full link: wait behind the stop line
          target = Math.min(target, Math.max(0, (distToEnd - 9) * 0.85));
        }
        if (next.buildT < 0.6) target = Math.min(target, 8 + 30 * next.buildT);
      } else if (!this.destinationNear(car, endNode)) {
        // nowhere to go: hold at the junction while we recompute
        target = Math.min(target, Math.max(0, (distToEnd - 6) * 0.8));
      }
    }

    target = Math.max(0, target);
    const rate = target > car.speed ? ACCEL : BRAKE;
    car.speed = approach(car.speed, target, rate, dt);
    if (car.speed < 0.05) car.speed = 0;

    car.t += car.dir * car.speed * dt;
    car.driven += car.speed * dt;

    // hard anti-overlap clamp
    if (gap !== Infinity && leader) {
      const g2 = car.dir === 1 ? leader.t - car.t - CAR_LENGTH : car.t - leader.t - CAR_LENGTH;
      if (g2 < 1.2) {
        car.t = car.dir === 1 ? leader.t - CAR_LENGTH - 1.2 : leader.t + CAR_LENGTH + 1.2;
        car.speed = Math.min(car.speed, leader.speed);
      }
    }
    car.t = clamp(car.t, -2, e.len + 2);

    // ---- arrival at the end of the link
    if (car.dir === 1 && car.t >= e.len) {
      this.arrive(car, e, e.b, car.t - e.len, dt);
      return;
    }
    if (car.dir === -1 && car.t <= 0) {
      this.arrive(car, e, e.a, -car.t, dt);
      return;
    }

    this.syncPosition(car);
    this.trackWaiting(car, dt);
  }

  private trackWaiting(car: Car, dt: number): void {
    car.tripTime += dt;
    if (car.speed < SIM.crawlSpeed) {
      car.wait += dt;
      if (car.wait > SIM.stuckAfter) {
        car.stuck = true;
        if (!car.honked && this.rng.chance(0.01)) {
          car.honked = true;
          this.hooks.onHonk?.();
        }
      }
    } else {
      car.wait = Math.max(0, car.wait - dt * 2.2);
      if (car.wait < SIM.stuckAfter * 0.5) {
        car.stuck = false;
        car.honked = false;
      }
    }
    if (car.tripTime > 260) this.despawn(car, true);
  }

  private syncPosition(car: Car): void {
    const e = car.edge;
    if (!e) return;
    const t = clamp(car.t, 0, e.len);
    const p = pointAtArc(e, t);
    const h = headingAtArc(e, t);
    const dirH = car.dir === 1 ? h : h + Math.PI;
    const halfLane = Math.min(ROADS[e.kind].width * 0.24, 4.6);
    // drive on the right: right of heading (y-down screen space) is (-sin, cos)
    const side = car.dir === 1 ? 1 : -1;
    car.x = p.x - Math.sin(dirH) * halfLane * side + car.laneOff * 0.4;
    car.y = p.y + Math.cos(dirH) * halfLane * side + car.laneOff * 0.4;
    car.a = dirH;
  }

  private peekNextEdge(car: Car, node: RNode): Edge | null {
    for (let i = car.pathIdx + 1; i < car.path.length; i++) {
      const step = car.path[i];
      const e = this.net.getEdge(step.e);
      if (!e) continue;
      if (e.a === node.id || e.b === node.id) return e;
    }
    return null;
  }

  private destinationNear(car: Car, node: RNode): boolean {
    if (node.zoneId === car.toZone) return true;
    const z = this.demand.zones[car.toZone];
    return !!z && dist(node, z) < z.radius;
  }

  private arrive(car: Car, from: Edge, nodeId: number, overflow: number, dt: number): void {
    this.net.detachCar(from, car);
    car.edge = null;
    const node = this.net.getNode(nodeId);
    if (!node) {
      this.stranded(car, dt);
      return;
    }

    // arrived?
    const destZone = this.demand.zones[car.toZone];
    if (node.zoneId === car.toZone || (destZone && dist(node, destZone) < destZone.radius * 0.75)) {
      this.deliver(car, destZone);
      return;
    }

    // walk the remaining path looking for a step that leaves this node
    while (car.pathIdx < car.path.length) {
      car.pathIdx++;
      const step = car.path[car.pathIdx];
      if (!step) break;
      const next = this.net.getEdge(step.e);
      if (!next) continue;
      if (next.a !== node.id && next.b !== node.id) continue;
      this.enterEdge(car, next, node, overflow);
      return;
    }

    // path exhausted or stale — recompute from here
    const route = destZone?.anchor ? findRoute(this.net, node, destZone.anchor) : null;
    if (route && route.steps.length) {
      car.path = route.steps;
      car.pathIdx = -1;
      const next = this.net.getEdge(route.steps[0].e);
      if (next && (next.a === node.id || next.b === node.id)) {
        this.enterEdge(car, next, node, overflow);
        return;
      }
    }
    car.needsPath = true;
    car.x = node.x;
    car.y = node.y;
    this.stranded(car, dt);
  }

  private enterEdge(car: Car, e: Edge, node: RNode, overflow: number): void {
    car.edge = e;
    car.dir = e.a === node.id ? 1 : -1;
    car.t = car.dir === 1 ? clamp(overflow + 0.4, 0.4, e.len - 0.4) : clamp(e.len - overflow - 0.4, 0.4, e.len - 0.4);
    car.speed = Math.min(car.speed, e.freeSpeed * 0.8);
    this.net.attachCar(e, car);
    this.syncPosition(car);
  }

  private deliver(car: Car, zone: Zone | undefined): void {
    car.alive = false;
    if (car.edge) {
      this.net.detachCar(car.edge, car);
      car.edge = null;
    }
    const s = this.stats;
    const distBonus = Math.max(0, car.tripDist);
    let fare = ECONOMY.baseFare + distBonus * ECONOMY.farePerUnit;
    s.combo++;
    s.bestCombo = Math.max(s.bestCombo, s.combo);
    fare *= 1 + Math.min(1, s.combo * 0.035);
    // a slow trip pays less: commuters tip badly
    const efficiency = clamp01(1 - Math.max(0, car.tripTime - distBonus / 60) / 90);
    fare *= 0.55 + 0.45 * efficiency;
    fare = Math.round(fare);
    s.delivered++;
    s.commuteSum += car.tripTime;
    s.income += fare;
    s.incomeWindow.push(this.elapsed + 0.0001);
    if (zone) {
      zone.served++;
      zone.pulse = 1;
      zone.inTransit = Math.max(0, zone.inTransit - 1);
    }
    const from = this.demand.zones[car.fromZone];
    if (from) from.inTransit = Math.max(0, from.inTransit - 1);
    this.hooks.onDeliver?.(car, fare, s.combo, zone ?? this.demand.zones[car.toZone]);
  }

  private despawn(car: Car, lost: boolean): void {
    car.alive = false;
    if (car.edge) {
      this.net.detachCar(car.edge, car);
      car.edge = null;
    }
    const from = this.demand.zones[car.fromZone];
    if (from) from.inTransit = Math.max(0, from.inTransit - 1);
    if (lost) {
      this.stats.lost++;
      this.stats.combo = 0;
      if (from) from.lost++;
      this.stats.jam = clamp01(this.stats.jam + 0.012);
      this.hooks.onLost?.(car);
    }
  }

  /** The car's road vanished (bulldozed / snapshot restore). Re-home it. */
  private stranded(car: Car, dt: number): void {
    if (car.edge) {
      this.net.detachCar(car.edge, car);
      car.edge = null;
    }
    car.speed = Math.max(0, car.speed - 40 * dt);
    car.wait += dt;
    car.tripTime += dt;
    car.nextRepath -= dt;
    if (car.nextRepath <= 0) {
      car.nextRepath = 0.6;
      if (this.rerouteBudget > 0) {
        this.rerouteBudget--;
        this.reroute(car);
      }
      if (car.edge) return;
    }
    if (car.wait > 14 || car.tripTime > 260) this.despawn(car, true);
  }

  private reroute(car: Car): void {
    const dest = this.demand.zones[car.toZone];
    if (!dest?.anchor) return;
    const node = this.net.nearestNodeAnywhere(car.x, car.y, 190);
    if (!node) return;
    const route = findRoute(this.net, node, dest.anchor);
    if (!route || !route.steps.length) return;
    const first = this.net.getEdge(route.steps[0].e);
    if (!first) return;
    car.path = route.steps;
    car.pathIdx = 0;
    car.needsPath = false;
    car.wait = Math.max(0, car.wait - 1);
    this.enterEdge(car, first, node, 2);
  }

  /**
   * Opportunistic rerouting: if the road ahead has jammed since the commuter
   * planned their trip, and a meaningfully cheaper alternative exists, they
   * take it at the next junction.
   */
  maybeReroute(car: Car): void {
    if (!car.edge) return;
    const dest = this.demand.zones[car.toZone];
    if (!dest?.anchor) return;
    const endId = car.dir === 1 ? car.edge.b : car.edge.a;
    const node = this.net.getNode(endId);
    if (!node) return;
    const route = findRoute(this.net, node, dest.anchor);
    if (!route || !route.steps.length) return;
    const current = this.planCost(car);
    if (current > 0 && route.cost < current * (1 - SIM.rerouteGain)) {
      car.path = [{ e: car.edge.id, d: car.dir }, ...route.steps];
      car.pathIdx = 0;
    }
  }

  private planCost(car: Car): number {
    let c = 0;
    for (let i = car.pathIdx + 1; i < car.path.length; i++) {
      const e = this.net.getEdge(car.path[i].e);
      if (!e) continue;
      c += (e.len / Math.max(8, e.freeSpeed)) * (1 + SIM.congestionWeight * e.congestion);
    }
    return c;
  }

  private updateJam(dt: number): void {
    const s = this.stats;
    const n = this.cars.length;
    if (n < 6 || this.elapsed < SIM.jamGrace) {
      s.jam = Math.max(0, s.jam - SIM.jamDrain * dt);
      s.peakJam = Math.max(s.peakJam, s.jam);
      return;
    }
    // severity blends "how slow is the city on average" with "how many are stuck"
    let speedSum = 0;
    let freeSum = 0;
    let stuck = 0;
    for (const c of this.cars) {
      const free = c.edge ? c.edge.freeSpeed : 40;
      speedSum += Math.min(c.speed, free);
      freeSum += free;
      if (c.stuck) stuck++;
    }
    const ratio = freeSum > 0 ? speedSum / freeSum : 1;
    const stuckFrac = stuck / n;
    const severity = clamp01(Math.max((0.42 - ratio) / 0.42, (stuckFrac - 0.5) / 0.5));
    s.severity = severity;
    if (severity > SIM.jamThreshold) {
      s.jam += (severity - SIM.jamThreshold) * 1.5 * SIM.jamFill * dt;
      if (s.jam > 0.6 && this.elapsed - this.lastWarn > 3.2) {
        this.lastWarn = this.elapsed;
        this.hooks.onJamWarn?.(s.jam);
      }
    } else {
      s.jam -= SIM.jamDrain * dt * (1 + (SIM.jamThreshold - severity) * 1.5);
    }
    s.jam = clamp01(s.jam);
    s.peakJam = Math.max(s.peakJam, s.jam);
  }

  private updateIncomeRate(): void {
    const s = this.stats;
    const w = s.incomeWindow;
    while (w.length && this.elapsed - w[0] > 8) w.shift();
    s.incomeRate = w.length / 8;
  }

  // ------------------------------------------------------------------ helpers

  carColor(car: Car): string {
    return DISTRICT_COLORS[car.colorIdx % DISTRICT_COLORS.length];
  }

  totalCommute(): number {
    return this.stats.delivered ? this.stats.commuteSum / this.stats.delivered : 0;
  }
}

/** Greenshields-ish speed/density relationship. */
export function densityFactor(e: Edge): number {
  const d = clamp(e.density, 0, 1.25);
  return clamp(1 - 0.86 * Math.min(1, d / 0.92), 0.08, 1);
}

/** Leader car in the same direction, found by binary search on sorted `t`. */
export function findLeader(list: Car[], car: Car): Car | null {
  const n = list.length;
  if (n < 2) return null;
  if (car.dir === 1) {
    let lo = 0;
    let hi = n;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (list[mid].t <= car.t) lo = mid + 1;
      else hi = mid;
    }
    return lo < n ? list[lo] : null;
  }
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].t < car.t) lo = mid + 1;
    else hi = mid;
  }
  return lo > 0 ? list[lo - 1] : null;
}

export type { Car };
