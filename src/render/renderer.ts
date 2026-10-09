/**
 * Canvas renderer.
 *
 * Two cached layers (terrain texture + road layer) are drawn as images every
 * frame with the camera transform; only cars, zones, effects and overlays are
 * re-drawn live. Cars are batched into one path per colour, which keeps a
 * thousand commuters cheap even on mid-range phones.
 */

import { CAR_LENGTH, CAR_WIDTH, DISTRICT_COLORS, ROADS, BUILD, type RoadKind, type ToolId } from '../game/config';
import { clamp, clamp01, TAU, type Vec2 } from '../core/math';
import type { Edge, Network, RNode } from '../net/network';
import type { Terrain } from '../world/terrain';
import type { Zone } from '../sim/demand';
import type { Car } from '../sim/car';

export interface Camera {
  x: number;
  y: number;
  /** css pixels per world unit */
  zoom: number;
}

export interface GhostRoad {
  pts: Vec2[];
  kind: RoadKind;
  valid: boolean;
  cost: number;
  affordable: boolean;
  water: boolean;
  /** where the start of the stroke snapped to, if anywhere */
  snap: Vec2 | null;
}

export type EffectKind = 'pop' | 'dust' | 'ring' | 'coin' | 'spark' | 'text';

export interface Effect {
  kind: EffectKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  text?: string;
  rot?: number;
}

export interface Scene {
  net: Network;
  terrain: Terrain;
  zones: Zone[];
  cars: Car[];
  night: number;
  time: number;
  ghost: GhostRoad | null;
  hint: { a: Vec2; b: Vec2 } | null;
  brush: { x: number; y: number; r: number } | null;
  tool: ToolId;
  showGrid: boolean;
  reduceMotion: boolean;
  jam: number;
  colorBlind: boolean;
  hoverEdge: Edge | null;
}

const ROAD_CASING: Record<RoadKind, string> = {
  street: '#202b34',
  avenue: '#243140',
  highway: '#2b3947',
};
const ROAD_FILL: Record<RoadKind, string> = {
  street: '#54697a',
  avenue: '#61798c',
  highway: '#8496a6',
};
const ROAD_MARK: Record<RoadKind, string> = {
  street: '#f0e2b4',
  avenue: '#ffe9a8',
  highway: '#ffffff',
};

export class Renderer {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  dpr = 1;
  vw = 800;
  vh = 600;
  world = 1000;
  cam: Camera = { x: 500, y: 500, zoom: 0.6 };
  minZoom = 0.1;
  maxZoom = 3;
  fitZoom = 0.6;

  private terrainLayer: HTMLCanvasElement;
  private roadLayer: HTMLCanvasElement;
  private glowSprite: HTMLCanvasElement;
  private texScale = 1.5;
  private roadsDirty = true;
  private freshIds = new Set<number>();
  private effects: Effect[] = [];
  fps = 60;
  private frameTimes: number[] = [];
  quality: 'auto' | 'high' | 'low' = 'auto';
  private lowPerf = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext('2d', { alpha: false, desynchronized: true });
    if (!ctx) throw new Error('Canvas 2D unavailable');
    this.ctx = ctx;
    this.terrainLayer = document.createElement('canvas');
    this.roadLayer = document.createElement('canvas');
    this.glowSprite = makeGlowSprite();
  }

  // ------------------------------------------------------------------- layout

  resize(cssW: number, cssH: number, dprCap = 2): void {
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    this.dpr = dpr;
    this.vw = Math.max(1, Math.floor(cssW));
    this.vh = Math.max(1, Math.floor(cssH));
    this.canvas.width = Math.floor(this.vw * dpr);
    this.canvas.height = Math.floor(this.vh * dpr);
    this.canvas.style.width = this.vw + 'px';
    this.canvas.style.height = this.vh + 'px';
    this.computeZoomLimits();
  }

  private maxTexture(): number {
    if (this.quality === 'low') return 1400;
    if (this.quality === 'high') return 2600;
    const touch = typeof window !== 'undefined' && (window.matchMedia?.('(hover: none)').matches || 'ontouchstart' in window);
    return touch ? 1800 : 2400;
  }

  private computeZoomLimits(): void {
    this.fitZoom = Math.min(this.vw, this.vh) / this.world;
    const dprCap = this.quality === 'low' ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    const desired = clamp(this.fitZoom * 3.4 * dprCap, 1, this.quality === 'low' ? 1.4 : 2.4);
    const maxTex = this.maxTexture();
    this.texScale = Math.min(desired, maxTex / this.world);
    this.maxZoom = (this.texScale / dprCap) * 1.12;
    this.minZoom = this.fitZoom * 0.72;
    this.roadsDirty = true;
  }

  setWorld(world: number, terrain: Terrain): void {
    this.world = world;
    this.computeZoomLimits();
    this.cam.x = world / 2;
    this.cam.y = world / 2;
    // portrait screens are tall: start a touch closer so the map owns the width
    const portrait = this.vh > this.vw * 1.15;
    this.cam.zoom = clamp(this.fitZoom * (portrait ? 1.16 : 1.02), this.minZoom, this.maxZoom);
    this.buildTerrainLayer(terrain);
    this.roadsDirty = true;
  }

  fitCamera(pad = 0.94): void {
    this.cam.x = this.world / 2;
    this.cam.y = this.world / 2;
    this.cam.zoom = clamp((Math.min(this.vw, this.vh) / this.world) * pad, this.minZoom, this.maxZoom);
    this.clampCamera();
  }

  clampCamera(): void {
    const halfW = this.vw / 2 / this.cam.zoom;
    const halfH = this.vh / 2 / this.cam.zoom;
    const marginX = Math.max(0, this.world / 2 - halfW * 0.55);
    const marginY = Math.max(0, this.world / 2 - halfH * 0.55);
    this.cam.x = clamp(this.cam.x, this.world / 2 - marginX, this.world / 2 + marginX);
    this.cam.y = clamp(this.cam.y, this.world / 2 - marginY, this.world / 2 + marginY);
    this.cam.zoom = clamp(this.cam.zoom, this.minZoom, this.maxZoom);
  }

  zoomAt(screenX: number, screenY: number, factor: number): void {
    const before = this.screenToWorld(screenX, screenY);
    this.cam.zoom = clamp(this.cam.zoom * factor, this.minZoom, this.maxZoom);
    const after = this.screenToWorld(screenX, screenY);
    this.cam.x += before.x - after.x;
    this.cam.y += before.y - after.y;
    this.clampCamera();
  }

  screenToWorld(sx: number, sy: number): Vec2 {
    return {
      x: this.cam.x + (sx - this.vw / 2) / this.cam.zoom,
      y: this.cam.y + (sy - this.vh / 2) / this.cam.zoom,
    };
  }

  worldToScreen(wx: number, wy: number): Vec2 {
    return {
      x: (wx - this.cam.x) * this.cam.zoom + this.vw / 2,
      y: (wy - this.cam.y) * this.cam.zoom + this.vh / 2,
    };
  }

  viewRect(pad = 0): { x0: number; y0: number; x1: number; y1: number } {
    const a = this.screenToWorld(-pad, -pad);
    const b = this.screenToWorld(this.vw + pad, this.vh + pad);
    return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
  }

  // ------------------------------------------------------------- static layers

  private buildTerrainLayer(terrain: Terrain): void {
    const px = clamp(Math.round(this.world * this.texScale), 256, this.maxTexture());
    terrain.renderTo(this.terrainLayer, px, px);
  }

  markRoadsDirty(): void {
    this.roadsDirty = true;
  }

  /** Repaint part (or all) of the cached terrain texture. */
  buildTerrainPatch(terrain: Terrain, x0: number, y0: number, x1: number, y1: number): void {
    const px = this.terrainLayer.width || Math.round(this.world * this.texScale);
    const full = x0 <= 0 && y0 <= 0 && x1 >= this.world && y1 >= this.world;
    terrain.renderTo(this.terrainLayer, px, px, full ? undefined : { x0, y0, x1, y1 });
  }

  /** Re-bake the road layer. Only called when the network actually changed. */
  buildRoadLayer(net: Network): void {
    const px = clamp(Math.round(this.world * this.texScale), 256, this.maxTexture());
    const c = this.roadLayer;
    if (c.width !== px || c.height !== px) {
      c.width = px;
      c.height = px;
    }
    const ctx = c.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, px, px);
    const k = px / this.world;
    ctx.setTransform(k, 0, 0, k, 0, 0);
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const edges = net.edges.filter((e) => e.buildT >= 1);
    const nodes = net.nodes;

    // --- shadows first (viaducts & bridges read much better with a drop shadow)
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = '#000';
    for (const e of edges) {
      if (!e.viaduct.length && !e.bridge) continue;
      ctx.lineWidth = ROADS[e.kind].width + 5;
      ctx.beginPath();
      ctx.moveTo(e.pts[0].x + 2.4, e.pts[0].y + 3.2);
      for (let i = 1; i < e.pts.length; i++) ctx.lineTo(e.pts[i].x + 2.4, e.pts[i].y + 3.2);
      ctx.stroke();
    }
    ctx.restore();

    // --- pass A: casings
    ctx.strokeStyle = ROAD_CASING.street;
    for (const kind of ['street', 'avenue', 'highway'] as RoadKind[]) {
      ctx.strokeStyle = ROAD_CASING[kind];
      ctx.lineWidth = ROADS[kind].width + 4.5;
      ctx.beginPath();
      for (const e of edges) {
        if (e.kind !== kind) continue;
        strokePolyline(ctx, e.pts);
      }
      ctx.stroke();
      // junction discs
      ctx.fillStyle = ROAD_CASING[kind];
      ctx.beginPath();
      for (const n of nodes) {
        const r = maxRoadWidth(n, net) / 2 + 2.4;
        if (r <= 0) continue;
        if (dominantKind(n, net) !== kind) continue;
        ctx.moveTo(n.x + r, n.y);
        ctx.arc(n.x, n.y, r, 0, TAU);
      }
      ctx.fill();
    }

    // --- pass B: asphalt
    for (const kind of ['street', 'avenue', 'highway'] as RoadKind[]) {
      ctx.strokeStyle = ROAD_FILL[kind];
      ctx.lineWidth = ROADS[kind].width;
      ctx.beginPath();
      for (const e of edges) {
        if (e.kind !== kind) continue;
        strokePolyline(ctx, e.pts);
      }
      ctx.stroke();
      ctx.fillStyle = ROAD_FILL[kind];
      ctx.beginPath();
      for (const n of nodes) {
        if (dominantKind(n, net) !== kind) continue;
        const r = maxRoadWidth(n, net) / 2;
        if (r <= 0) continue;
        ctx.moveTo(n.x + r, n.y);
        ctx.arc(n.x, n.y, r, 0, TAU);
      }
      ctx.fill();
    }

    // --- pass C: markings
    ctx.strokeStyle = ROAD_MARK.street;
    ctx.lineWidth = 0.9;
    ctx.setLineDash([7, 9]);
    ctx.beginPath();
    for (const e of edges) {
      if (e.kind !== 'street') continue;
      strokePolyline(ctx, e.pts);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // avenues: solid centre + edge lines
    ctx.lineWidth = 1.1;
    ctx.strokeStyle = ROAD_MARK.avenue;
    ctx.beginPath();
    for (const e of edges) {
      if (e.kind !== 'avenue') continue;
      strokePolyline(ctx, e.pts);
    }
    ctx.stroke();
    ctx.setLineDash([10, 8]);
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 0.8;
    ctx.beginPath();
    for (const e of edges) {
      if (e.kind !== 'avenue') continue;
      strokeOffsetPolyline(ctx, e, ROADS.avenue.width * 0.25);
      strokeOffsetPolyline(ctx, e, -ROADS.avenue.width * 0.25);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // freeways: solid edge lines + dashed lane dividers
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (const e of edges) {
      if (e.kind !== 'highway') continue;
      strokeOffsetPolyline(ctx, e, ROADS.highway.width * 0.42);
      strokeOffsetPolyline(ctx, e, -ROADS.highway.width * 0.42);
    }
    ctx.stroke();
    ctx.setLineDash([12, 12]);
    ctx.strokeStyle = 'rgba(255,255,255,0.45)';
    ctx.lineWidth = 0.9;
    ctx.beginPath();
    for (const e of edges) {
      if (e.kind !== 'highway') continue;
      strokeOffsetPolyline(ctx, e, ROADS.highway.width * 0.14);
      strokeOffsetPolyline(ctx, e, -ROADS.highway.width * 0.14);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    // --- pass D: bridge rails
    ctx.strokeStyle = 'rgba(226,236,244,0.55)';
    ctx.lineWidth = 1.3;
    for (const e of edges) {
      if (!e.bridge && !e.viaduct.length) continue;
      const w = ROADS[e.kind].width * 0.5;
      ctx.beginPath();
      strokeOffsetPolyline(ctx, e, w);
      strokeOffsetPolyline(ctx, e, -w);
      ctx.stroke();
    }

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.roadsDirty = false;
  }

  // ------------------------------------------------------------------- frames

  beginFrame(now: number): void {
    if (this.frameTimes.length) {
      const dt = now - this.frameTimes[this.frameTimes.length - 1];
      this.frameTimes.push(now);
      if (this.frameTimes.length > 40) this.frameTimes.shift();
      const avg = dt > 0 ? dt : 16.7;
      this.fps = this.fps * 0.9 + (1000 / Math.max(1, avg)) * 0.1;
    } else {
      this.frameTimes.push(now);
    }
    if (this.quality === 'auto') {
      this.lowPerf = this.fps < 42 && this.frameTimes.length > 30;
    } else {
      this.lowPerf = this.quality === 'low';
    }
  }

  draw(scene: Scene): void {
    const ctx = this.ctx;
    const d = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // the sea beyond the map edge: makes letterboxing look like open water
    const bg = ctx.createRadialGradient(
      this.canvas.width / 2,
      this.canvas.height / 2,
      Math.min(this.canvas.width, this.canvas.height) * 0.1,
      this.canvas.width / 2,
      this.canvas.height / 2,
      Math.max(this.canvas.width, this.canvas.height) * 0.75,
    );
    bg.addColorStop(0, '#0c2233');
    bg.addColorStop(0.55, '#081826');
    bg.addColorStop(1, '#05090d');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);

    if (this.roadsDirty) this.buildRoadLayer(scene.net);

    const z = this.cam.zoom;
    const tx = this.vw / 2 - this.cam.x * z;
    const ty = this.vh / 2 - this.cam.y * z;
    ctx.setTransform(d * z, 0, 0, d * z, d * tx, d * ty);

    // map backdrop
    ctx.drawImage(this.terrainLayer, 0, 0, this.world, this.world);
    ctx.drawImage(this.roadLayer, 0, 0, this.world, this.world);

    // coastline frame around the playable map
    ctx.save();
    ctx.strokeStyle = 'rgba(214,232,240,0.16)';
    ctx.lineWidth = 2.5 / z;
    ctx.strokeRect(0, 0, this.world, this.world);
    ctx.restore();

    if (scene.showGrid && z > 0.55) this.drawGrid(z);

    this.drawFresh(scene);
    this.drawCongestion(scene);
    this.drawHint(scene);
    this.drawZones(scene, z);
    this.drawGhost(scene, z);
    this.drawCars(scene, z);
    this.drawBrush(scene, z);
    this.updateEffects(1 / 60);
    this.drawEffects(z);
    this.drawHover(scene, z);

    // ---- screen space
    ctx.setTransform(d, 0, 0, d, 0, 0);
    this.drawNight(scene);
    this.drawLabels(scene);
    this.drawOffscreenZones(scene);
    this.drawJamVignette(scene);
  }

  private drawGrid(z: number): void {
    const ctx = this.ctx;
    const r = this.viewRect(0);
    const step = BUILD.grid;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.055)';
    ctx.lineWidth = 1 / z;
    ctx.beginPath();
    const x0 = Math.floor(r.x0 / step) * step;
    const y0 = Math.floor(r.y0 / step) * step;
    for (let x = x0; x <= r.x1; x += step) {
      ctx.moveTo(x, Math.max(0, r.y0));
      ctx.lineTo(x, Math.min(this.world, r.y1));
    }
    for (let y = y0; y <= r.y1; y += step) {
      ctx.moveTo(Math.max(0, r.x0), y);
      ctx.lineTo(Math.min(this.world, r.x1), y);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** Roads that are still being paved are drawn live, then baked once done. */
  private drawFresh(scene: Scene): void {
    const ctx = this.ctx;
    const live = new Set<number>();
    for (const e of scene.net.edges) {
      if (e.buildT >= 1) continue;
      live.add(e.id);
      const spec = ROADS[e.kind];
      const cut = cutAtArc(e, e.builtLen);
      if (cut.length < 2) continue;
      ctx.save();
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.globalAlpha = 0.35;
      ctx.strokeStyle = '#000';
      ctx.lineWidth = spec.width + 5;
      ctx.beginPath();
      strokePolyline(ctx, cut);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = ROAD_CASING[e.kind];
      ctx.lineWidth = spec.width + 4.5;
      ctx.beginPath();
      strokePolyline(ctx, cut);
      ctx.stroke();
      ctx.strokeStyle = '#454439';
      ctx.lineWidth = spec.width;
      ctx.beginPath();
      strokePolyline(ctx, cut);
      ctx.stroke();
      // the paver: a bright head where the asphalt is still rolling out
      const head = cut[cut.length - 1];
      ctx.strokeStyle = 'rgba(255,196,90,0.75)';
      ctx.lineWidth = Math.max(1.4, spec.width * 0.2);
      ctx.beginPath();
      ctx.arc(head.x, head.y, spec.width * 0.28, 0, TAU);
      ctx.stroke();
      ctx.restore();
    }
    // an edge that finished paving must be folded into the cached layer
    for (const id of this.freshIds) {
      if (!live.has(id)) {
        this.roadsDirty = true;
        break;
      }
    }
    this.freshIds = live;
  }

  private drawCongestion(scene: Scene): void {
    const ctx = this.ctx;
    const r = this.viewRect(20);
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (const e of scene.net.edges) {
      if (e.congestion < 0.28) continue;
      if (!polylineInView(e, r)) continue;
      const c = congestionColor(e.congestion);
      ctx.strokeStyle = c;
      ctx.globalAlpha = 0.28 + 0.5 * clamp01(e.congestion);
      ctx.lineWidth = Math.max(1.6, ROADS[e.kind].width * 0.42);
      ctx.beginPath();
      strokePolyline(ctx, e.pts);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawHint(scene: Scene): void {
    if (!scene.hint) return;
    const ctx = this.ctx;
    const { a, b } = scene.hint;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 3.2;
    ctx.setLineDash([12, 10]);
    ctx.lineDashOffset = -(scene.time * 26) % 22;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    // an L-shaped suggestion reads like a real road plan
    ctx.lineTo(b.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
  }

  private drawZones(scene: Scene, z: number): void {
    const ctx = this.ctx;
    const r = this.viewRect(80);
    const t = scene.time;
    for (const zone of scene.zones) {
      if (zone.x < r.x0 || zone.x > r.x1 || zone.y < r.y0 || zone.y > r.y1) continue;
      const connected = !!zone.anchor;
      const col = zone.color;
      // never let a district shrink below ~22 px on screen
      const rad = Math.max(15, 22 / Math.max(0.12, z)) + zone.pulse * 4;

      // connection radius ring
      ctx.save();
      ctx.globalAlpha = connected ? 0.1 : 0.16 + 0.08 * Math.sin(t * 3);
      ctx.strokeStyle = connected ? col : '#ff5a4e';
      ctx.lineWidth = 1.8 / Math.max(0.2, z * 0.9);
      ctx.setLineDash(connected ? [] : [6, 6]);
      ctx.beginPath();
      ctx.arc(zone.x, zone.y, zone.radius, 0, TAU);
      ctx.stroke();
      ctx.restore();

      // halo
      ctx.save();
      const pulse = connected ? 0.5 + 0.5 * Math.sin(t * 2 + zone.id) : 0.5 + 0.5 * Math.sin(t * 6);
      ctx.globalAlpha = 0.12 + 0.16 * pulse + zone.pulse * 0.4;
      ctx.fillStyle = connected ? col : '#ff5a4e';
      ctx.beginPath();
      ctx.arc(zone.x, zone.y, rad + 10 + pulse * 5 + zone.pulse * 16, 0, TAU);
      ctx.fill();
      ctx.restore();

      // pad
      ctx.save();
      ctx.translate(zone.x, zone.y);
      ctx.lineWidth = Math.max(1.6, 2.4 / Math.max(0.3, z));
      ctx.fillStyle = 'rgba(8,12,16,0.86)';
      roundRectPath(ctx, -rad, -rad, rad * 2, rad * 2, rad * 0.42);
      ctx.fill();
      ctx.strokeStyle = connected ? col : '#ff5a4e';
      roundRectPath(ctx, -rad, -rad, rad * 2, rad * 2, rad * 0.42);
      ctx.stroke();

      // glyph
      ctx.fillStyle = connected ? col : '#ff5a4e';
      if (scene.colorBlind) {
        ctx.font = `700 ${rad * 1.05}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(zone.kind, 0, rad * 0.06);
      } else {
        drawZoneGlyph(ctx, zone.kind, rad * 0.62);
      }
      // demand bar
      const demand = clamp01(zone.inTransit / 14);
      if (demand > 0.02) {
        ctx.fillStyle = 'rgba(255,255,255,0.16)';
        roundRectPath(ctx, -rad * 0.8, rad * 0.72, rad * 1.6, 2.6, 1.3);
        ctx.fill();
        ctx.fillStyle = col;
        roundRectPath(ctx, -rad * 0.8, rad * 0.72, rad * 1.6 * demand, 2.6, 1.3);
        ctx.fill();
      }
      ctx.restore();
      void z;
    }
  }

  private drawGhost(scene: Scene, z: number): void {
    const g = scene.ghost;
    if (!g || g.pts.length < 2) return;
    const ctx = this.ctx;
    const spec = ROADS[g.kind];
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const col = !g.affordable ? '#ff5a4e' : g.water && !g.valid ? '#ff9f43' : '#ffffff';
    ctx.globalAlpha = 0.22;
    ctx.strokeStyle = col;
    ctx.lineWidth = spec.width + 6;
    ctx.beginPath();
    strokePolyline(ctx, g.pts);
    ctx.stroke();
    ctx.globalAlpha = 0.62;
    ctx.fillStyle = '#0e1620';
    ctx.beginPath();
    strokePolyline(ctx, g.pts);
    ctx.lineWidth = spec.width;
    ctx.strokeStyle = '#0e1620';
    ctx.stroke();
    ctx.globalAlpha = 0.85;
    ctx.setLineDash([9, 8]);
    ctx.lineDashOffset = -(scene.time * 30) % 17;
    ctx.strokeStyle = col;
    ctx.lineWidth = Math.max(1.2, spec.width * 0.16);
    ctx.beginPath();
    strokePolyline(ctx, g.pts);
    ctx.stroke();
    ctx.setLineDash([]);

    // endpoint handles
    ctx.globalAlpha = 0.95;
    for (const p of [g.pts[0], g.pts[g.pts.length - 1]]) {
      ctx.fillStyle = col;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3.4 + 1.2 / z, 0, TAU);
      ctx.fill();
    }
    // snap target ring
    if (g.snap) {
      ctx.globalAlpha = 0.9;
      ctx.strokeStyle = '#7ef9ff';
      ctx.lineWidth = 2.2 / Math.max(0.4, z);
      ctx.beginPath();
      ctx.arc(g.snap.x, g.snap.y, 9, 0, TAU);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawBrush(scene: Scene, z: number): void {
    const b = scene.brush;
    if (!b) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = scene.tool === 'bulldoze' ? 'rgba(255,90,78,0.85)' : 'rgba(255,255,255,0.6)';
    ctx.lineWidth = 1.8 / z;
    ctx.setLineDash([5 / z, 4 / z]);
    ctx.beginPath();
    ctx.arc(b.x, b.y, b.r, 0, TAU);
    ctx.stroke();
    ctx.restore();
  }

  private drawHover(scene: Scene, z: number): void {
    const e = scene.hoverEdge;
    if (!e) return;
    const ctx = this.ctx;
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)';
    ctx.lineWidth = ROADS[e.kind].width + 3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    strokePolyline(ctx, e.pts);
    ctx.stroke();
    ctx.restore();
    void z;
  }

  private drawCars(scene: Scene, z: number): void {
    const ctx = this.ctx;
    const r = this.viewRect(24);
    const small = z < 0.55 || this.lowPerf;
    const hl = small ? 2.2 : CAR_LENGTH * 0.5;
    const hw = small ? 2.2 : CAR_WIDTH * 0.5;

    // group by colour for batched fills
    const groups = new Map<number, number[]>();
    const stuckList: Car[] = [];
    for (const car of scene.cars) {
      if (car.x < r.x0 || car.x > r.x1 || car.y < r.y0 || car.y > r.y1) continue;
      let arr = groups.get(car.colorIdx);
      if (!arr) {
        arr = [];
        groups.set(car.colorIdx, arr);
      }
      const c = Math.cos(car.a);
      const s = Math.sin(car.a);
      arr.push(car.x, car.y, c, s);
      if (car.stuck) stuckList.push(car);
    }

    // dark outline pass
    ctx.save();
    ctx.fillStyle = 'rgba(6,10,14,0.75)';
    ctx.beginPath();
    for (const arr of groups.values()) {
      for (let i = 0; i < arr.length; i += 4) pushQuad(ctx, arr[i], arr[i + 1], arr[i + 2], arr[i + 3], hl + 1, hw + 1);
    }
    ctx.fill();

    // coloured pass
    for (const [idx, arr] of groups) {
      ctx.fillStyle = DISTRICT_COLORS[idx % DISTRICT_COLORS.length];
      ctx.beginPath();
      for (let i = 0; i < arr.length; i += 4) pushQuad(ctx, arr[i], arr[i + 1], arr[i + 2], arr[i + 3], hl, hw);
      ctx.fill();
    }
    ctx.restore();

    // stuck markers
    if (stuckList.length && !scene.reduceMotion) {
      ctx.save();
      const pulse = 0.45 + 0.35 * Math.sin(scene.time * 7);
      ctx.strokeStyle = `rgba(255,90,78,${pulse.toFixed(3)})`;
      ctx.lineWidth = 1.6;
      const cap = Math.min(stuckList.length, 90);
      ctx.beginPath();
      for (let i = 0; i < cap; i++) {
        const c = stuckList[i];
        ctx.moveTo(c.x + 6.5, c.y);
        ctx.arc(c.x, c.y, 6.5, 0, TAU);
      }
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawNight(scene: Scene): void {
    if (scene.night <= 0.01) return;
    const ctx = this.ctx;
    const n = scene.night;
    ctx.save();
    ctx.globalCompositeOperation = 'multiply';
    ctx.fillStyle = `rgba(${Math.round(28 + 90 * (1 - n))},${Math.round(40 + 90 * (1 - n))},${Math.round(
      74 + 80 * (1 - n),
    )},1)`;
    ctx.globalAlpha = 0.12 + 0.42 * n;
    ctx.fillRect(0, 0, this.vw, this.vh);
    ctx.restore();

    if (n < 0.25 || this.lowPerf) return;
    const r = this.viewRect(30);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    let count = 0;
    const size = 16 * this.cam.zoom;
    for (const car of scene.cars) {
      if (count > 260) break;
      if (car.x < r.x0 || car.x > r.x1 || car.y < r.y0 || car.y > r.y1) continue;
      const p = this.worldToScreen(car.x, car.y);
      ctx.globalAlpha = 0.5 * n;
      ctx.drawImage(this.glowSprite, p.x - size / 2, p.y - size / 2, size, size);
      count++;
    }
    // district windows
    for (const zone of scene.zones) {
      const p = this.worldToScreen(zone.x, zone.y);
      if (p.x < -60 || p.y < -60 || p.x > this.vw + 60 || p.y > this.vh + 60) continue;
      const s = 66 * this.cam.zoom;
      ctx.globalAlpha = 0.34 * n;
      ctx.drawImage(this.glowSprite, p.x - s / 2, p.y - s / 2, s, s);
    }
    ctx.restore();
  }

  private drawLabels(scene: Scene): void {
    const ctx = this.ctx;
    if (this.cam.zoom < 0.34) return;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const fs = clamp(11 * Math.min(1.25, this.cam.zoom * 1.6), 9, 15);
    ctx.font = `700 ${fs}px ui-sans-serif, system-ui, sans-serif`;
    for (const zone of scene.zones) {
      const p = this.worldToScreen(zone.x, zone.y);
      if (p.x < -80 || p.x > this.vw + 80 || p.y < -60 || p.y > this.vh + 60) continue;
      const label = zone.name.toUpperCase();
      const y = p.y + 15 * Math.min(1.4, this.cam.zoom * 1.7) + 4;
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(6,10,14,0.85)';
      ctx.strokeText(label, p.x, y);
      ctx.fillStyle = zone.anchor ? 'rgba(232,238,242,0.92)' : 'rgba(255,120,110,0.95)';
      ctx.fillText(label, p.x, y);
      if (this.cam.zoom > 0.5) {
        const sub = !zone.anchor
          ? 'needs a road'
          : zone.linked === 0
            ? 'no route yet'
            : `${zone.served} served · ${zone.linked} linked`;
        ctx.font = `600 ${Math.max(8, fs - 2.5)}px ui-sans-serif, system-ui, sans-serif`;
        ctx.lineWidth = 2.6;
        ctx.strokeStyle = 'rgba(6,10,14,0.8)';
        ctx.strokeText(sub, p.x, y + fs + 2);
        ctx.fillStyle = !zone.anchor
          ? 'rgba(255,140,130,0.95)'
          : zone.linked === 0
            ? 'rgba(255,206,120,0.95)'
            : 'rgba(147,167,182,0.9)';
        ctx.fillText(sub, p.x, y + fs + 2);
        ctx.font = `700 ${fs}px ui-sans-serif, system-ui, sans-serif`;
      }
    }
    ctx.restore();
  }

  private drawOffscreenZones(scene: Scene): void {
    const ctx = this.ctx;
    ctx.save();
    for (const zone of scene.zones) {
      const p = this.worldToScreen(zone.x, zone.y);
      const m = 26;
      if (p.x > m && p.x < this.vw - m && p.y > m && p.y < this.vh - m) continue;
      const cx = clamp(p.x, m, this.vw - m);
      const cy = clamp(p.y, m, this.vh - m);
      const ang = Math.atan2(p.y - this.vh / 2, p.x - this.vw / 2);
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(ang);
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = zone.anchor ? zone.color : '#ff5a4e';
      ctx.beginPath();
      ctx.moveTo(9, 0);
      ctx.lineTo(-5, 6);
      ctx.lineTo(-5, -6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.globalAlpha = 0.28;
      ctx.fillStyle = zone.anchor ? zone.color : '#ff5a4e';
      ctx.beginPath();
      ctx.arc(cx, cy, 13, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawJamVignette(scene: Scene): void {
    if (scene.jam < 0.25) return;
    const ctx = this.ctx;
    const a = clamp01((scene.jam - 0.25) / 0.75) * (0.35 + 0.2 * Math.sin(scene.time * 5));
    const g = ctx.createRadialGradient(
      this.vw / 2,
      this.vh / 2,
      Math.min(this.vw, this.vh) * 0.28,
      this.vw / 2,
      this.vh / 2,
      Math.max(this.vw, this.vh) * 0.72,
    );
    g.addColorStop(0, 'rgba(255,60,50,0)');
    g.addColorStop(1, `rgba(255,60,50,${a.toFixed(3)})`);
    ctx.save();
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.vw, this.vh);
    ctx.restore();
  }

  // ------------------------------------------------------------------ effects

  pop(x: number, y: number, color: string, size = 8): void {
    this.effects.push({ kind: 'ring', x, y, vx: 0, vy: 0, life: 0.55, maxLife: 0.55, size, color });
  }

  coin(x: number, y: number, text: string, color = '#ffd479'): void {
    this.effects.push({ kind: 'text', x, y, vx: 0, vy: -22, life: 1.1, maxLife: 1.1, size: 12, color, text });
  }

  dust(x: number, y: number, n = 8): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const s = 12 + Math.random() * 34;
      this.effects.push({
        kind: 'dust',
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 0.4 + Math.random() * 0.4,
        maxLife: 0.8,
        size: 2 + Math.random() * 3.5,
        color: '#8d7f6a',
      });
    }
  }

  spark(x: number, y: number, color: string, n = 6): void {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU;
      const s = 20 + Math.random() * 60;
      this.effects.push({
        kind: 'spark',
        x,
        y,
        vx: Math.cos(a) * s,
        vy: Math.sin(a) * s,
        life: 0.35 + Math.random() * 0.35,
        maxLife: 0.7,
        size: 1.6 + Math.random() * 2,
        color,
      });
    }
  }

  clearEffects(): void {
    this.effects.length = 0;
  }

  private updateEffects(dt: number): void {
    const list = this.effects;
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      e.life -= dt;
      if (e.life <= 0) {
        list.splice(i, 1);
        continue;
      }
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      if (e.kind === 'dust') {
        e.vx *= 0.92;
        e.vy *= 0.92;
      }
      if (e.kind === 'spark') {
        e.vx *= 0.9;
        e.vy *= 0.9;
      }
      if (e.kind === 'text') e.vy += 26 * dt;
    }
    if (list.length > 420) list.splice(0, list.length - 420);
  }

  private drawEffects(z: number): void {
    const ctx = this.ctx;
    ctx.save();
    for (const e of this.effects) {
      const k = e.life / e.maxLife;
      if (e.kind === 'ring') {
        ctx.globalAlpha = k * 0.8;
        ctx.strokeStyle = e.color;
        ctx.lineWidth = 2.4 * k + 0.6;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.size * (1.6 - k) + 4, 0, TAU);
        ctx.stroke();
      } else if (e.kind === 'dust' || e.kind === 'spark') {
        ctx.globalAlpha = k * 0.85;
        ctx.fillStyle = e.color;
        ctx.beginPath();
        ctx.arc(e.x, e.y, e.size * (e.kind === 'dust' ? 1 : k), 0, TAU);
        ctx.fill();
      } else if (e.kind === 'text' && e.text) {
        const fs = Math.max(9, 12 / Math.max(0.35, z * 0.9));
        ctx.globalAlpha = clamp01(k * 1.6);
        ctx.font = `800 ${fs / z}px ui-sans-serif, system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 3 / z;
        ctx.strokeStyle = 'rgba(6,10,14,0.8)';
        ctx.strokeText(e.text, e.x, e.y);
        ctx.fillStyle = e.color;
        ctx.fillText(e.text, e.x, e.y);
      }
    }
    ctx.restore();
  }

  get isLowPerf(): boolean {
    return this.lowPerf;
  }
}

// ------------------------------------------------------------------- helpers

function strokePolyline(ctx: CanvasRenderingContext2D, pts: readonly Vec2[]): void {
  if (pts.length < 2) return;
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
}

/** Offset polyline (poor man's parallel curve — fine for road markings). */
function strokeOffsetPolyline(ctx: CanvasRenderingContext2D, e: Edge, off: number): void {
  const pts = e.pts;
  if (pts.length < 2) return;
  let started = false;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const l = Math.hypot(dx, dy) || 1;
    const nx = (-dy / l) * off;
    const ny = (dx / l) * off;
    if (!started) {
      ctx.moveTo(a.x + nx, a.y + ny);
      started = true;
    }
    ctx.lineTo(b.x + nx, b.y + ny);
  }
}

function pushQuad(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  c: number,
  s: number,
  hl: number,
  hw: number,
): void {
  const x1 = x + c * hl;
  const y1 = y + s * hl;
  const x2 = x - c * hl;
  const y2 = y - s * hl;
  const px = -s * hw;
  const py = c * hw;
  ctx.moveTo(x1 + px, y1 + py);
  ctx.lineTo(x1 - px, y1 - py);
  ctx.lineTo(x2 - px, y2 - py);
  ctx.lineTo(x2 + px, y2 + py);
  ctx.closePath();
}

function maxRoadWidth(n: RNode, net: Network): number {
  let w = 0;
  for (const id of n.edges) {
    const e = net.getEdge(id);
    if (e) w = Math.max(w, ROADS[e.kind].width);
  }
  return w;
}

function dominantKind(n: RNode, net: Network): RoadKind {
  let best: RoadKind = 'street';
  let bw = -1;
  for (const id of n.edges) {
    const e = net.getEdge(id);
    if (!e) continue;
    const w = ROADS[e.kind].width;
    if (w > bw) {
      bw = w;
      best = e.kind;
    }
  }
  return best;
}

function roundRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.lineTo(x + w - rr, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
  ctx.lineTo(x + w, y + h - rr);
  ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
  ctx.lineTo(x + rr, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
  ctx.lineTo(x, y + rr);
  ctx.quadraticCurveTo(x, y, x + rr, y);
  ctx.closePath();
}

function drawZoneGlyph(ctx: CanvasRenderingContext2D, kind: string, s: number): void {
  ctx.beginPath();
  if (kind === 'R') {
    // house
    ctx.moveTo(-s, s * 0.15);
    ctx.lineTo(0, -s * 0.85);
    ctx.lineTo(s, s * 0.15);
    ctx.lineTo(s, s * 0.9);
    ctx.lineTo(-s, s * 0.9);
    ctx.closePath();
    ctx.fill();
  } else if (kind === 'C') {
    // office block
    ctx.rect(-s * 0.8, -s * 0.9, s * 1.6, s * 1.8);
    ctx.fill();
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 2; c++) {
        ctx.fillRect(-s * 0.52 + c * s * 0.62, -s * 0.62 + r * s * 0.56, s * 0.36, s * 0.3);
      }
    }
    ctx.restore();
  } else {
    // factory
    ctx.moveTo(-s, s * 0.9);
    ctx.lineTo(-s, -s * 0.1);
    ctx.lineTo(-s * 0.25, s * 0.25);
    ctx.lineTo(-s * 0.25, -s * 0.1);
    ctx.lineTo(s * 0.5, s * 0.25);
    ctx.lineTo(s * 0.5, -s * 0.9);
    ctx.lineTo(s, -s * 0.9);
    ctx.lineTo(s, s * 0.9);
    ctx.closePath();
    ctx.fill();
  }
}

/** Prefix of an edge's polyline up to arc length `t` (used for paving). */
function cutAtArc(e: Edge, t: number): Vec2[] {
  if (t <= 0) return [];
  if (t >= e.len) return e.pts;
  const out: Vec2[] = [];
  for (let i = 0; i < e.pts.length - 1; i++) {
    out.push(e.pts[i]);
    if (e.cum[i + 1] >= t) {
      const segLen = e.cum[i + 1] - e.cum[i];
      const f = segLen < 1e-6 ? 1 : (t - e.cum[i]) / segLen;
      out.push({
        x: e.pts[i].x + (e.pts[i + 1].x - e.pts[i].x) * f,
        y: e.pts[i].y + (e.pts[i + 1].y - e.pts[i].y) * f,
      });
      break;
    }
  }
  return out;
}

function congestionColor(c: number): string {
  const t = clamp01(c);
  if (t < 0.5) {
    const k = t / 0.5;
    return `rgb(${Math.round(90 + 165 * k)},${Math.round(208 - 40 * k)},${Math.round(122 - 60 * k)})`;
  }
  const k = (t - 0.5) / 0.5;
  return `rgb(${Math.round(255 - 20 * k)},${Math.round(168 - 108 * k)},${Math.round(62 - 20 * k)})`;
}

function polylineInView(e: Edge, r: { x0: number; y0: number; x1: number; y1: number }): boolean {
  for (const p of e.pts) {
    if (p.x >= r.x0 && p.x <= r.x1 && p.y >= r.y0 && p.y <= r.y1) return true;
  }
  return false;
}

function makeGlowSprite(): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 64;
  const ctx = c.getContext('2d');
  if (ctx) {
    const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
    g.addColorStop(0, 'rgba(255,226,160,0.95)');
    g.addColorStop(0.35, 'rgba(255,196,110,0.34)');
    g.addColorStop(1, 'rgba(255,180,90,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 64);
  }
  return c;
}

export { congestionColor, roundRectPath };
