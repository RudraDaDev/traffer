/**
 * Game orchestrator: world lifecycle, the fixed-step loop, editing tools,
 * economy, win/lose rules, scoring and persistence.
 */

import {
  BUILD,
  ECONOMY,
  ROADS,
  SIM,
  ZONE_NAMES,
  type GameMode,
  type RoadKind,
  type ToolId,
  type ZoneKind,
} from './config';
import {
  ALL_TOOLS,
  CHAPTERS,
  type LevelDef,
  type LevelResult,
  type SandboxSave,
  type Settings,
} from './types';
import { LEVELS, LEVEL_BY_ID, levelIndex, nextLevel } from './levels';
import { dailySeed, dayOfYear, endlessDifficulty, generateLevel, sandboxLevel } from './generator';
import { autoConnect, refreshAnchors, suggestHint } from './solver';
import { Network, type Snapshot } from '../net/network';
import { Demand, resetDistrictNames } from '../sim/demand';
import { Traffic } from '../sim/traffic';
import { Terrain } from '../world/terrain';
import { Renderer, type GhostRoad } from '../render/renderer';
import { Input } from './input';
import { Audio } from '../core/audio';
import { SaveData } from './save';
import { HUD, type HudState, type ToolInfo } from '../ui/hud';
import { Screens, type ScreenCtx, type ScreenId } from '../ui/screens';
import { haptic } from '../ui/widgets';
import { clamp, clamp01, dist, formatMoney, formatNumber, type Vec2 } from '../core/math';
import { RNG } from '../core/rng';
import { el } from '../core/dom';
import type { Car } from '../sim/car';

export type GameState = 'menu' | 'brief' | 'playing' | 'paused' | 'over';

interface UndoEntry {
  snap: Snapshot;
  money: number;
  zones: ZoneDump[];
}

interface ZoneDump {
  x: number;
  y: number;
  kind: ZoneKind;
  colorIdx: number;
  name: string;
  baseRate: number;
  served: number;
}

const MAX_UNDO = 40;

export class Game {
  readonly app: HTMLElement;
  readonly canvas: HTMLCanvasElement;
  readonly renderer: Renderer;
  readonly hud: HUD;
  readonly screens: Screens;
  readonly audio = new Audio();
  readonly save = new SaveData();
  private input!: Input;
  private toasts!: HTMLElement;

  terrain = new Terrain(900);
  net!: Network;
  demand!: Demand;
  traffic!: Traffic;

  level: LevelDef | null = null;
  mode: GameMode = 'campaign';
  state: GameState = 'menu';
  money = 0;
  spent = 0;
  earned = 0;
  elapsed = 0;
  roadsBuilt = 0;
  private speedIdx = 1;
  tool: ToolId = 'street';
  zoneKind: ZoneKind = 'R';
  private attract = false;
  private rng = new RNG('traffer');

  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];

  private stroke: Vec2[] | null = null;
  private snapPoint: Vec2 | null = null;
  private ghost: GhostRoad | null = null;
  private bulldozing = false;
  private hoverEdgeId = -1;

  private hint: { a: Vec2; b: Vec2; why: string } | null = null;
  private hintUntil = 0;
  private hintTimer = 0;
  private night = 0;
  private dayT = 0.28;
  private acc = 0;
  private lastNow = 0;
  private rafId = 0;
  private tensionClock = 0;
  private fpsNode: HTMLElement | null = null;
  private tutorialStep = 0;
  private tutorialList: { head: string; body: string; check: () => boolean }[] = [];
  private tutorialHold = 0;
  private lastResult: LevelResult | null = null;
  private chapterTab = 0;
  private comboShown = 0;

  constructor(app: HTMLElement) {
    this.app = app;
    this.canvas = el('canvas', { id: 'stage' }) as HTMLCanvasElement;
    this.app.appendChild(this.canvas);
    this.renderer = new Renderer(this.canvas);

    this.hud = new HUD({
      onPause: () => this.togglePause(),
      onTool: (t) => this.setTool(t),
      onSpeed: () => this.cycleSpeed(),
      onUndo: () => this.undo(),
      onRedo: () => this.redo(),
      onHint: () => this.useHint(),
      onZoom: (d) => this.renderer.zoomAt(this.renderer.vw / 2, this.renderer.vh / 2, d > 0 ? 1.35 : 1 / 1.35),
      onFit: () => this.renderer.fitCamera(),
      onSave: () => this.saveSandbox(),
    });
    this.app.appendChild(this.hud.root);

    this.screens = new Screens({
      onPlayCampaign: () => this.openScreen('levels'),
      onPickLevel: (id) => this.prepareCampaign(id),
      onStartLevel: () => this.beginLevel(),
      onEndless: (seed, d) => this.startEndless(seed, d),
      onDaily: () => this.startDaily(),
      onSandboxNew: (seed, size) => this.startSandbox(seed, size),
      onSandboxLoad: (id) => this.loadSandbox(id),
      onSandboxSave: () => this.saveSandbox(),
      onSandboxDelete: (id) => {
        this.save.deleteSandbox(id);
        this.openScreen('sandbox');
        this.toast('City deleted');
      },
      onOpen: (id) => this.openScreen(id),
      onBack: () => this.backScreen(),
      onResume: () => this.resume(),
      onRestart: () => this.restart(),
      onQuit: () => this.quitToMenu(),
      onNext: () => this.nextLevelGo(),
      onExitResults: () => this.exitResults(),
      onSetting: (k, v) => this.setSetting(k, v),
      onResetProgress: () => {
        this.save.resetAll();
        this.save.persist();
        this.toast('Progress erased', 'bad');
      },
      onCloseScreens: () => this.closeScreens(),
    });
    this.app.appendChild(this.screens.root);

    this.toasts = el('div', { id: 'toasts' });
    this.app.appendChild(this.toasts);

    this.save.load();
    this.applySettings();
    this.setupInput();
    this.setupResize();
    this.resize();

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.state === 'playing') this.pause();
        this.audio.suspend();
      } else {
        this.audio.resume();
      }
    });
    window.addEventListener('pagehide', () => this.save.persist());

    this.loop = this.loop.bind(this);
    this.startAttract();
    this.openScreen('menu');
    this.rafId = requestAnimationFrame(this.loop);
  }

  // ------------------------------------------------------------------ wiring

  private setupInput(): void {
    this.input = new Input(this.canvas, {
      onDown: (p) => this.pointerDown(p),
      onMove: (p) => this.pointerMove(p),
      onUp: (p) => this.pointerUp(p),
      onTap: (p) => this.pointerTap(p),
      onPan: (dx, dy) => this.panBy(dx, dy),
      onZoom: (f, sx, sy) => this.renderer.zoomAt(sx, sy, f),
      onHover: (p) => this.hover(p),
      onKey: (k, ev) => this.key(k, ev),
      onGestureStart: () => {
        this.stroke = null;
        this.ghost = null;
        this.bulldozing = false;
      },
      onGestureEnd: () => {},
    });
  }

  private setupResize(): void {
    const onResize = () => this.resize();
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', () => window.setTimeout(onResize, 120));
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(onResize).observe(this.app);
  }

  private resize(): void {
    const w = this.app.clientWidth || window.innerWidth;
    const h = this.app.clientHeight || window.innerHeight;
    const dprCap = this.save.settings.quality === 'low' ? 1 : Math.min(window.devicePixelRatio || 1, 2);
    const before = { ...this.renderer.cam };
    this.renderer.quality = this.save.settings.quality;
    this.renderer.resize(w, h, dprCap);
    this.renderer.cam.zoom = clamp(before.zoom || this.renderer.fitZoom, this.renderer.minZoom, this.renderer.maxZoom);
    this.renderer.clampCamera();
    this.renderer.markRoadsDirty();
    this.updateFpsNode();
  }

  private updateFpsNode(): void {
    const want = this.save.settings.showFps;
    if (want && !this.fpsNode) {
      this.fpsNode = el('div', { class: 'chip' });
      this.fpsNode.style.cssText =
        'position:absolute;top:calc(var(--topbar) + var(--sat) + 62px);right:10px;z-index:15;pointer-events:none;font-size:10px';
      this.app.appendChild(this.fpsNode);
    } else if (!want && this.fpsNode) {
      this.fpsNode.remove();
      this.fpsNode = null;
    }
  }

  // ------------------------------------------------------------- world setup

  /** Build terrain + network + demand for a level definition. */
  private setupWorld(level: LevelDef, mode: GameMode): void {
    this.level = level;
    this.mode = mode;
    resetDistrictNames();
    this.rng = new RNG(level.seed + '|' + mode);
    this.terrain = new Terrain(level.size).generate(level.seed, level.terrain);
    this.net = new Network(this.terrain, level.size);
    this.demand = new Demand(this.net);
    this.traffic = new Traffic(this.net, this.demand, level.seed + mode);
    this.traffic.maxCars = mode === 'campaign' ? 900 : SIM.maxCars;

    level.zones.forEach((z, i) => {
      const wx = clamp(z.x, 0.04, 0.96) * level.size;
      const wy = clamp(z.y, 0.04, 0.96) * level.size;
      this.terrain.ensureLand(wx, wy, 62);
      this.demand.add(wx, wy, z.kind, {
        weight: z.weight ?? 1,
        colorIdx: z.color ?? i,
        name: z.name,
      });
    });
    this.demand.rebuildMatrix();
    this.demand.updateAnchors();

    this.traffic.hooks = {
      onDeliver: (car, fare, combo, zone) => this.onDeliver(car, fare, combo, zone?.name),
      onLost: () => {
        if (!this.attract && this.rng.chance(0.25)) this.audio.denied();
      },
      onHonk: () => {
        if (!this.attract) this.audio.honk();
      },
      onJamWarn: () => {
        if (!this.attract) {
          this.audio.alarm();
          haptic(24, true);
        }
      },
    };

    this.renderer.setWorld(level.size, this.terrain);
    this.renderer.clearEffects();
    this.undoStack = [];
    this.redoStack = [];
    this.stroke = null;
    this.ghost = null;
    this.hint = null;
    this.hintUntil = 0;
    this.night = 0;
    this.dayT = 0.26;
    this.elapsed = 0;
    this.acc = 0;
    this.spent = 0;
    this.earned = 0;
    this.roadsBuilt = 0;
    this.comboShown = 0;
    this.money = level.goal.budget;
  }

  private startAttract(): void {
    const seed = 'attract-' + Math.floor(Math.random() * 9999);
    const level = generateLevel({ mode: 'endless', seed, difficulty: 2 });
    level.goal.jamFails = false;
    level.demand = { start: 0.3, end: 0.55, rampEnd: 200 };
    this.attract = true;
    this.state = 'menu';
    this.setupWorld(level, 'endless');
    const kinds: RoadKind[] = ['street', 'avenue'];
    autoConnect(this.net, this.demand.zones, level.size * 22, new RNG(seed + '-a'), kinds);
    refreshAnchors(this.net, this.demand.zones);
    this.money = 0;
    this.hud.show(false);
    this.input.enabled = false;
  }

  // -------------------------------------------------------------- navigation

  private screenCtx(): ScreenCtx {
    const dSeed = dailySeed();
    return {
      progress: this.save.progress,
      stats: this.save.stats,
      settings: this.save.settings,
      level: this.level,
      result: this.lastResult,
      chapter: this.chapterTab,
      sandbox: this.save.sandboxIndex(),
      endlessBest: this.save.endlessBest,
      dailyBest: this.save.dailyScore(dSeed),
      dailySeed: dSeed,
      dailyDone: this.save.dailyScore(dSeed) > 0,
      nextLevelId: this.level ? nextLevel(this.level.id)?.id ?? null : null,
      fromScreen: this.screens.current,
    };
  }

  openScreen(id: ScreenId): void {
    if (id === 'levels') this.chapterTab = this.guessChapter();
    this.input.enabled = false;
    this.screens.show(id, this.screenCtx());
    this.audio.unlock();
    this.audio.click();
  }

  private guessChapter(): number {
    if (this.level && this.level.chapter >= 0) return this.level.chapter;
    for (let c = CHAPTERS.length - 1; c >= 0; c--) {
      const list = LEVELS.filter((l) => l.chapter === c);
      if (list.some((l) => (this.save.progress.campaign[l.id]?.stars ?? 0) > 0)) return c;
    }
    return 0;
  }

  backScreen(): void {
    this.audio.back();
    this.screens.back();
    if (this.screens.current === 'none') this.closeScreens();
  }

  closeScreens(): void {
    this.screens.hide();
    if (this.state === 'playing') this.input.enabled = true;
  }

  private prepareCampaign(id: string): void {
    const level = LEVEL_BY_ID.get(id);
    if (!level) return;
    this.save.progress.lastLevel = id;
    this.save.persist();
    this.stopAttract();
    this.state = 'brief';
    this.loadPreviewWorld(level, 'campaign');
    this.openScreen('brief');
  }

  /** Show the map behind the briefing card — it sells the level. */
  private loadPreviewWorld(level: LevelDef, mode: GameMode): void {
    this.setupWorld(level, mode);
    this.hud.show(false);
    this.input.enabled = false;
    this.renderer.fitCamera();
  }

  private beginLevel(): void {
    if (!this.level) return;
    this.screens.hide();
    this.state = 'playing';
    this.speedIdx = 1;
    this.attract = false;
    this.input.enabled = true;
    this.hud.show(true);
    this.setupTutorial();
    this.audio.unlock();
    this.audio.startAmbient();
    this.toast(`${this.level.name} — ${formatMoney(this.money)} to spend`, 'good');
  }

  private stopAttract(): void {
    this.attract = false;
  }

  startEndless(seed: string, difficulty: number): void {
    this.stopAttract();
    const level = generateLevel({ mode: 'endless', seed, difficulty });
    this.lastResult = null;
    this.loadPreviewWorld(level, 'endless');
    this.chapterTab = -1;
    this.beginLevel();
    this.toast(`Seed ${seed} · difficulty ${difficulty}`, 'good');
  }

  startDaily(): void {
    this.stopAttract();
    const seed = dailySeed();
    const d = 4 + (dayOfYear() % 9);
    const level = generateLevel({ mode: 'daily', seed, difficulty: d });
    level.name = `Daily · ${seed}`;
    level.brief = 'Everyone on Earth gets this exact city today. Deliver as many commuters as you can before gridlock.';
    this.lastResult = null;
    this.loadPreviewWorld(level, 'daily');
    this.beginLevel();
  }

  startSandbox(seed: string, size: number): void {
    this.stopAttract();
    const level = sandboxLevel(seed, size);
    level.goal.budget = 1e9;
    level.goal.deliver = 0;
    level.goal.jamFails = false;
    level.tools = { ...ALL_TOOLS, zone: true };
    level.name = `Sandbox · ${seed}`;
    this.lastResult = null;
    this.loadPreviewWorld(level, 'sandbox');
    this.beginLevel();
    this.setTool('street');
    this.toast('Unlimited funds. Build anything.', 'good');
  }

  saveSandbox(): void {
    if (!this.level || this.mode !== 'sandbox') {
      this.toast('Sandbox worlds only', 'bad');
      return;
    }
    const id = this.level.seed + '-' + this.level.size;
    const snap = this.net.snapshot();
    const world: SandboxSave = {
      id,
      name: `Sandbox ${this.level.seed}`,
      seed: this.level.seed,
      size: this.level.size,
      savedAt: Date.now(),
      money: this.money,
      delivered: this.traffic.stats.delivered,
      nodes: snap.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y })),
      edges: snap.edges.map((e) => ({
        id: e.id,
        a: e.a,
        b: e.b,
        k: e.kind,
        pts: e.pts,
        br: e.bridge,
        cost: e.cost,
      })),
      zones: this.demand.zones.map((z) => ({ x: z.x, y: z.y, kind: z.kind, color: z.colorIdx, name: z.name })),
      camera: { ...this.renderer.cam },
    };
    const ok = this.save.saveSandbox(world);
    this.save.persist();
    this.toast(ok ? 'City saved' : 'Save failed — storage full', ok ? 'good' : 'bad');
    this.audio.coin();
  }

  loadSandbox(id: string): void {
    const world = this.save.loadSandbox(id);
    if (!world) {
      this.toast('That save is gone', 'bad');
      return;
    }
    this.stopAttract();
    const level = sandboxLevel(world.seed, world.size);
    level.zones = world.zones.map((z, i) => ({
      x: z.x / world.size,
      y: z.y / world.size,
      kind: z.kind,
      weight: 1,
      color: z.color ?? i,
      name: z.name,
    }));
    level.goal.budget = 1e9;
    level.goal.deliver = 0;
    level.goal.jamFails = false;
    level.tools = { ...ALL_TOOLS, zone: true };
    level.name = world.name;
    this.loadPreviewWorld(level, 'sandbox');
    const snap: Snapshot = {
      nodes: world.nodes.map((n) => ({ id: n.id, x: n.x, y: n.y, kind: 'end', zoneId: null })),
      edges: world.edges.map((e) => ({ id: e.id, a: e.a, b: e.b, kind: e.k, pts: e.pts, bridge: !!e.br, cost: e.cost ?? 0 })),
      nextNodeId: world.nodes.reduce((a, n) => Math.max(a, n.id), 0) + 1,
      nextEdgeId: world.edges.reduce((a, e) => Math.max(a, e.id), 0) + 1,
    };
    this.net.restore(snap);
    this.demand.updateAnchors();
    this.money = world.money || 1e9;
    this.renderer.markRoadsDirty();
    this.renderer.buildTerrainPatch(this.terrain, 0, 0, world.size, world.size);
    if (world.camera) {
      this.renderer.cam.x = world.camera.x;
      this.renderer.cam.y = world.camera.y;
      this.renderer.cam.zoom = clamp(world.camera.zoom, this.renderer.minZoom, this.renderer.maxZoom);
      this.renderer.clampCamera();
    }
    this.beginLevel();
    this.toast(`${world.name} loaded`, 'good');
  }

  restart(): void {
    if (!this.level) return;
    const level = this.level;
    const mode = this.mode;
    this.screens.hide();
    this.setupWorld(level, mode);
    this.state = 'playing';
    this.input.enabled = true;
    this.hud.show(true);
    this.setupTutorial();
    this.audio.click();
    this.toast('Fresh map, fresh budget');
  }

  nextLevelGo(): void {
    const id = this.level ? nextLevel(this.level.id)?.id : null;
    if (!id) {
      this.quitToMenu();
      return;
    }
    this.prepareCampaign(id);
    this.beginLevel();
  }

  quitToMenu(): void {
    this.abandon();
    this.screens.hide();
    this.hud.show(false);
    this.state = 'menu';
    this.audio.stopAmbient();
    this.startAttract();
    this.openScreen('menu');
  }

  /** Leave a running level without scoring it. */
  private abandon(): void {
    if (this.state === 'playing' || this.state === 'paused') {
      const s = this.save.stats;
      s.delivered += this.traffic.stats.delivered;
      s.moneySpent += this.spent;
      s.moneyEarned += this.earned;
      s.levelsFailed++;
      this.save.persist();
    }
    this.audio.stopAmbient();
    this.state = 'menu';
  }

  /** From the results screen: back to the level browser (campaign) or menu. */
  private exitResults(): void {
    const wasCampaign = this.mode === 'campaign' && (this.level?.chapter ?? -1) >= 0;
    this.screens.hide();
    this.hud.show(false);
    this.state = 'menu';
    this.startAttract();
    this.openScreen(wasCampaign ? 'levels' : 'menu');
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.enabled = false;
    this.stroke = null;
    this.ghost = null;
    this.bulldozing = false;
    this.audio.setTension(0);
    this.openScreen('pause');
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.state = 'playing';
    this.screens.hide();
    this.input.enabled = true;
    this.audio.unlock();
    this.audio.click();
  }

  togglePause(): void {
    if (this.state === 'playing') this.pause();
    else if (this.state === 'paused') this.resume();
  }

  // ------------------------------------------------------------------- tools

  setTool(t: ToolId): void {
    if (t === this.tool && t === 'zone') {
      this.cycleZoneKind();
      return;
    }
    this.tool = t;
    document.body.classList.toggle('tool-bulldoze', t === 'bulldoze');
    this.audio.click();
    haptic(8);
    this.stroke = null;
    this.ghost = null;
  }

  private cycleZoneKind(): void {
    const order: ZoneKind[] = ['R', 'C', 'I'];
    this.zoneKind = order[(order.indexOf(this.zoneKind) + 1) % order.length];
    this.audio.click();
    this.toast(`Placing ${ZONE_NAMES[this.zoneKind]} (${this.zoneKind})`);
  }

  cycleSpeed(): void {
    this.speedIdx = (this.speedIdx + 1) % SIM.speeds.length;
    this.audio.click();
  }

  private get speed(): number {
    return SIM.speeds[this.speedIdx];
  }

  private toolsAvailable(): ToolSpecLike {
    return this.level?.tools ?? ALL_TOOLS;
  }

  private toolInfos(): ToolInfo[] {
    const t = this.toolsAvailable();
    const out: ToolInfo[] = [];
    const keys = ['1', '2', '3'];
    (['street', 'avenue', 'highway'] as RoadKind[]).forEach((k, i) => {
      const on = k === 'street' ? t.street !== false : !!t[k];
      if (!on) return;
      out.push({
        id: k,
        name: ROADS[k].name,
        cost: `$${ROADS[k].cost}/m`,
        icon: k,
        enabled: true,
        key: keys[i],
      });
    });
    if (t.zone) {
      out.push({
        id: 'zone',
        name: this.zoneKind,
        cost: ZONE_NAMES[this.zoneKind],
        icon: 'users',
        enabled: true,
        key: 'Q',
      });
    }
    if (t.bulldoze !== false) {
      out.push({ id: 'bulldoze', name: 'Raze', cost: '+35%', icon: 'bulldoze', enabled: true, key: 'X' });
    }
    return out;
  }

  // ------------------------------------------------------------------ editing

  private pointerDown(p: Vec2): void {
    if (this.state !== 'playing' || !this.net) return;
    this.audio.unlock();
    if (this.tool === 'bulldoze') {
      this.bulldozing = true;
      this.pushUndo();
      this.bulldozeAt(p);
      return;
    }
    if (this.tool === 'zone') {
      this.placeZone(p);
      return;
    }
    if (this.tool === 'inspect') return;
    this.stroke = [this.snapPointFor(p)];
    this.snapPoint = this.findSnap(p);
    this.updateGhost();
  }

  private pointerMove(p: Vec2): void {
    if (this.state !== 'playing' || !this.net) return;
    if (this.bulldozing) {
      this.bulldozeAt(p);
      return;
    }
    if (!this.stroke) return;
    const last = this.stroke[this.stroke.length - 1];
    if (dist(last, p) < 3.2) return;
    let q = p;
    if (this.save.settings.angleSnap && this.stroke.length >= 2) {
      // keep the live stroke tidy: snap the newest segment to 45° increments
      const prev = this.stroke[this.stroke.length - 2];
      const a = Math.atan2(p.y - prev.y, p.x - prev.x);
      const l = dist(prev, p);
      const step = Math.PI / 4;
      const k = Math.round(a / step);
      if (Math.abs(a - k * step) < BUILD.angleTolerance * 1.6) {
        q = { x: prev.x + Math.cos(k * step) * l, y: prev.y + Math.sin(k * step) * l };
      }
    }
    q = this.clampToWorld(q);
    this.stroke.push(q);
    this.updateGhost();
  }

  private pointerUp(_p: Vec2): void {
    if (this.state !== 'playing') return;
    if (this.bulldozing) {
      this.bulldozing = false;
      return;
    }
    if (!this.stroke) return;
    const pts = this.stroke;
    this.stroke = null;
    this.ghost = null;
    if (pts.length < 2) return;
    this.buildRoad(pts);
  }

  private pointerTap(p: Vec2): void {
    if (this.state !== 'playing' || !this.net) return;
    if (this.tool === 'inspect') {
      const e = this.net.edgeAt(p.x, p.y, 12);
      if (e) {
        this.toast(
          `${ROADS[e.kind].name} · ${Math.round(e.len)} m · ${e.carsF.length + e.carsB.length} cars · ${Math.round(
            e.congestion * 100,
          )}% full`,
        );
      }
      return;
    }
  }

  private clampToWorld(p: Vec2): Vec2 {
    const m = 6;
    return { x: clamp(p.x, m, this.level!.size - m), y: clamp(p.y, m, this.level!.size - m) };
  }

  private snapPointFor(p: Vec2): Vec2 {
    const snap = this.findSnap(p);
    if (snap) return snap;
    if (this.save.settings.gridSnap) {
      const gx = Math.round(p.x / BUILD.grid) * BUILD.grid;
      const gy = Math.round(p.y / BUILD.grid) * BUILD.grid;
      if (Math.abs(gx - p.x) < BUILD.gridSnap && Math.abs(gy - p.y) < BUILD.gridSnap) return { x: gx, y: gy };
    }
    return p;
  }

  private findSnap(p: Vec2): Vec2 | null {
    const n = this.net.nearestNode(p.x, p.y, BUILD.nodeSnap);
    if (n) return { x: n.x, y: n.y };
    const e = this.net.nearestEdgePoint(p.x, p.y, BUILD.edgeSnap);
    if (e) return e.point;
    return null;
  }

  private updateGhost(): void {
    if (!this.stroke || this.stroke.length < 2) {
      this.ghost = null;
      return;
    }
    const kind = this.tool as RoadKind;
    if (!(kind in ROADS)) {
      this.ghost = null;
      return;
    }
    const est = this.net.estimateCost(this.stroke, kind);
    this.ghost = {
      pts: this.stroke,
      kind,
      valid: est.water <= 4 || !!this.toolsAvailable().bridge,
      cost: est.cost,
      affordable: est.cost <= this.money,
      water: est.water > 4,
      snap: this.snapPoint,
    };
  }

  private buildRoad(pts: Vec2[]): void {
    const kind = this.tool as RoadKind;
    if (!(kind in ROADS)) return;
    const tools = this.toolsAvailable();
    if (kind !== 'street' && !tools[kind]) {
      this.toast(`${ROADS[kind].name}s are locked on this level`, 'bad');
      this.audio.denied();
      return;
    }
    this.pushUndo();
    const res = this.net.buildPath(pts, kind, this.money, {
      bridge: tools.bridge !== false,
      angleSnap: this.save.settings.angleSnap,
      gridSnap: this.save.settings.gridSnap,
    });
    if (!res.ok) {
      this.popUndo();
      this.audio.denied();
      haptic(18, true);
      if (res.reason === 'no-funds') this.toast(res.message ?? 'Not enough funds', 'bad');
      else if (res.reason === 'no-bridge') this.toast(res.message ?? 'Bridges are locked here', 'bad');
      else this.toast('Draw a longer stretch of road', 'bad');
      return;
    }
    const netCost = Math.max(0, res.cost - res.refund);
    this.money -= netCost;
    this.spent += netCost;
    this.roadsBuilt += res.edges.length;
    this.save.stats.roadsBuilt += res.edges.length;
    this.save.stats.roadLength += res.length;
    this.save.stats.moneySpent += netCost;
    this.renderer.markRoadsDirty();
    this.audio.pave(clamp01(res.length / 400) * 0.7 + 0.5);
    haptic(res.length > 200 ? 20 : 10);
    for (const e of res.edges) {
      const mid = e.pts[Math.floor(e.pts.length / 2)];
      this.renderer.dust(mid.x, mid.y, this.save.settings.reduceMotion ? 2 : 5);
    }
    if (res.refund > 0) this.toast(`Upgraded — ${formatMoney(res.refund)} refunded`, 'good');
    if (res.partial) this.toast(res.message ?? 'Out of funds part way', 'bad');
    if (res.bridges > 0 && !res.partial) this.toast(`${res.bridges} bridge${res.bridges > 1 ? 's' : ''} built`);
    this.redoStack.length = 0;
    this.hintTimer = 0;
  }

  private bulldozeAt(p: Vec2): void {
    const q = this.clampToWorld(p);
    const removed = this.net.deleteArea(q.x, q.y, 14);
    if (!removed.length) return;
    let refund = 0;
    for (const e of removed) {
      refund += e.cost * ECONOMY.refund;
      this.renderer.dust(e.pts[0].x, e.pts[0].y, this.save.settings.reduceMotion ? 2 : 6);
    }
    this.money += refund;
    this.spent = Math.max(0, this.spent - refund);
    this.renderer.markRoadsDirty();
    this.audio.bulldoze();
    haptic(10);
    this.traffic.heal();
  }

  private placeZone(p: Vec2): void {
    if (!this.toolsAvailable().zone) return;
    const q = this.clampToWorld(p);
    for (const z of this.demand.zones) {
      if (dist(z, q) < 40) {
        this.toast('Too close to another district', 'bad');
        this.audio.denied();
        return;
      }
    }
    this.pushUndo();
    this.terrain.ensureLand(q.x, q.y, 62);
    this.renderer.buildTerrainPatch(this.terrain, q.x - 90, q.y - 90, q.x + 90, q.y + 90);
    const z = this.demand.add(q.x, q.y, this.zoneKind, { colorIdx: this.demand.zones.length });
    this.demand.rebuildMatrix();
    this.renderer.pop(q.x, q.y, z.color, 14);
    this.renderer.spark(q.x, q.y, z.color, 10);
    this.audio.pave(0.8);
    haptic(12);
    this.toast(`${z.name} founded — ${ZONE_NAMES[this.zoneKind]}`, 'good');
  }

  // -------------------------------------------------------------------- undo

  private dumpZones(): ZoneDump[] {
    return this.demand.zones.map((z) => ({
      x: z.x,
      y: z.y,
      kind: z.kind,
      colorIdx: z.colorIdx,
      name: z.name,
      baseRate: z.baseRate,
      served: z.served,
    }));
  }

  pushUndo(): void {
    if (!this.net) return;
    this.undoStack.push({ snap: this.net.snapshot(), money: this.money, zones: this.dumpZones() });
    if (this.undoStack.length > MAX_UNDO) this.undoStack.shift();
  }

  private popUndo(): void {
    this.undoStack.pop();
  }

  undo(): void {
    if (!this.undoStack.length || this.state !== 'playing') return;
    const entry = this.undoStack.pop()!;
    this.redoStack.push({ snap: this.net.snapshot(), money: this.money, zones: this.dumpZones() });
    this.applyEntry(entry);
    this.audio.back();
  }

  redo(): void {
    if (!this.redoStack.length || this.state !== 'playing') return;
    const entry = this.redoStack.pop()!;
    this.undoStack.push({ snap: this.net.snapshot(), money: this.money, zones: this.dumpZones() });
    this.applyEntry(entry);
    this.audio.click();
  }

  private applyEntry(entry: UndoEntry): void {
    this.net.restore(entry.snap);
    this.money = entry.money;
    this.demand.clear();
    for (const z of entry.zones) {
      const made = this.demand.add(z.x, z.y, z.kind, { colorIdx: z.colorIdx, name: z.name });
      made.baseRate = z.baseRate;
      made.served = z.served;
    }
    this.demand.rebuildMatrix();
    this.demand.updateAnchors();
    this.traffic.heal();
    this.renderer.markRoadsDirty();
    this.hintTimer = 0;
  }

  // -------------------------------------------------------------------- loop

  private loop(now: number): void {
    this.rafId = requestAnimationFrame(this.loop);
    this.tick(now);
  }

  /** One frame of work. Split out so the headless smoke test can drive it. */
  private tick(now: number): void {
    const dtReal = this.lastNow ? clamp((now - this.lastNow) / 1000, 0, 0.1) : 1 / 60;
    this.lastNow = now;
    this.renderer.beginFrame(now);

    const active = this.state === 'playing' || this.attract;
    if (active && this.speed > 0) {
      this.acc += dtReal * this.speed;
      let steps = 0;
      const maxSteps = SIM.maxStepsPerFrame * Math.max(1, this.speed);
      while (this.acc >= SIM.dt && steps < maxSteps) {
        this.step(SIM.dt);
        this.acc -= SIM.dt;
        steps++;
      }
      if (steps >= maxSteps) this.acc = 0;
    } else {
      this.acc = 0;
    }

    if (this.state === 'playing') {
      this.save.stats.playTime += dtReal;
      this.updateHintClock(dtReal);
      this.updateTutorial(dtReal);
    } else if (this.attract) {
      this.updateAttractCamera(dtReal);
    }

    this.render();
    if (this.state === 'playing' || this.state === 'paused') this.syncHud();
    if (this.fpsNode) this.fpsNode.textContent = `${Math.round(this.renderer.fps)} fps · ${this.traffic.cars.length} cars`;
  }

  private step(dt: number): void {
    const level = this.level;
    if (!level) return;
    this.elapsed += dt;

    const ramp = level.demand ?? { start: 0.6, end: 1, rampEnd: 90 };
    let end = ramp.end;
    if (this.mode === 'endless' || this.mode === 'daily') {
      const d = endlessDifficulty(this.traffic.stats.delivered, this.elapsed) - (level.difficulty ?? 0);
      end = ramp.end * (1 + Math.max(0, d) * 0.16);
    }
    this.demand.tick(dt, this.elapsed, { start: ramp.start, end, rampEnd: ramp.rampEnd });
    this.traffic.update(dt);

    if (this.save.settings.dayNight && !this.attract && this.mode !== 'campaign') {
      this.dayT = (this.dayT + dt / 210) % 1;
      const n = Math.sin(this.dayT * Math.PI * 2 - Math.PI / 2) * 0.5 + 0.5;
      this.night = clamp01((n - 0.45) / 0.4);
    } else if (this.attract) {
      this.dayT = (this.dayT + dt / 300) % 1;
      const n = Math.sin(this.dayT * Math.PI * 2 - Math.PI / 2) * 0.5 + 0.5;
      this.night = clamp01((n - 0.5) / 0.35) * 0.85;
    }

    if (!this.attract) {
      this.tensionClock -= dt;
      if (this.tensionClock <= 0) {
        this.tensionClock = 0.5;
        this.audio.setTension(this.traffic.stats.jam);
      }
      if (level.goal.deliver > 0 && this.traffic.stats.delivered >= level.goal.deliver) {
        this.finish(true, 'goal');
        return;
      }
      if (level.goal.jamFails && this.traffic.stats.jam >= 1) {
        this.finish(false, 'gridlock');
        return;
      }
      if (level.goal.time && this.elapsed >= level.goal.time) {
        this.finish(this.traffic.stats.delivered >= level.goal.deliver, 'timeout');
      }
    }
  }

  private render(): void {
    const hover = this.hoverEdgeId >= 0 ? this.net.getEdge(this.hoverEdgeId) ?? null : null;
    this.renderer.draw({
      net: this.net,
      terrain: this.terrain,
      zones: this.demand.zones,
      cars: this.traffic.cars,
      night: this.night,
      time: performance.now() / 1000,
      ghost: this.ghost,
      hint: this.hintUntil > this.elapsed ? this.hint : null,
      brush:
        this.tool === 'bulldoze' && this.input.hoverScreen && this.state === 'playing'
          ? { ...this.renderer.screenToWorld(this.input.hoverScreen.x, this.input.hoverScreen.y), r: 14 }
          : null,
      tool: this.tool,
      showGrid: this.save.settings.gridSnap && this.state === 'playing',
      reduceMotion: this.save.settings.reduceMotion,
      jam: this.traffic.stats.jam,
      colorBlind: this.save.settings.colorBlind,
      hoverEdge: hover,
    });
  }

  private updateAttractCamera(dt: number): void {
    const t = performance.now() / 1000;
    const c = this.renderer.cam;
    const size = this.level?.size ?? 1000;
    c.x = size / 2 + Math.cos(t * 0.06) * size * 0.16;
    c.y = size / 2 + Math.sin(t * 0.045) * size * 0.14;
    const target = this.renderer.fitZoom * (1.16 + Math.sin(t * 0.08) * 0.07);
    c.zoom = clamp(c.zoom + (target - c.zoom) * dt * 0.6, this.renderer.minZoom, this.renderer.maxZoom);
    this.renderer.clampCamera();
  }

  private syncHud(): void {
    const level = this.level;
    if (!level) return;
    const st = this.traffic.stats;
    const ch = CHAPTERS[level.chapter];
    const state: HudState = {
      levelName: level.name,
      chapterName: ch
        ? `${ch.name} · ${levelIndex(level.id) + 1}/${LEVELS.length}`
        : level.mode === 'sandbox'
          ? 'Sandbox · unlimited funds'
          : level.mode === 'daily'
            ? 'Daily challenge'
            : `Endless · difficulty ${Math.round(endlessDifficulty(st.delivered, this.elapsed))}`,
      mode: this.mode,
      money: this.money,
      income: st.incomeRate * (st.delivered ? this.earned / st.delivered : ECONOMY.baseFare + 3),
      delivered: st.delivered,
      goal: level.goal.deliver,
      time: this.elapsed,
      cars: st.cars,
      jam: st.jam,
      jamEnabled: !!level.goal.jamFails,
      tool: this.tool,
      tools: this.toolInfos(),
      speed: this.speed,
      canUndo: this.undoStack.length > 0,
      canRedo: this.redoStack.length > 0,
      showSave: this.mode === 'sandbox',
      hintText: this.hint?.why ?? null,
      stars: this.liveStars(),
      gridlock: st.jam > 0.62 && !!level.goal.jamFails,
      paused: this.state === 'paused',
    };
    this.hud.sync(state);
  }

  private liveStars(): number {
    const level = this.level;
    if (!level || level.goal.deliver <= 0) return 0;
    const st = this.traffic.stats;
    if (st.delivered < level.goal.deliver) return 0;
    let stars = 1;
    if (st.peakJam <= 0.5) stars = 2;
    if (st.peakJam <= 0.25 && level.par?.commute && this.avgCommute() <= level.par.commute) stars = 3;
    return stars;
  }

  private avgCommute(): number {
    return this.traffic.totalCommute();
  }

  // ------------------------------------------------------------------- hints

  private updateHintClock(dt: number): void {
    this.hintTimer -= dt;
    if (this.hintTimer > 0) return;
    this.hintTimer = 2.5;
    if (this.demand.zones.length < 2) {
      this.hint = null;
      return;
    }
    this.hint = suggestHint(this.net, this.demand.zones);
  }

  private useHint(): void {
    if (!this.hint) {
      this.updateHintClock(99);
    }
    if (!this.hint) {
      this.toast('Nothing obvious to suggest');
      return;
    }
    this.hintUntil = this.elapsed + 9;
    this.toast(this.hint.why, 'good');
    this.audio.click();
    const mid = { x: (this.hint.a.x + this.hint.b.x) / 2, y: (this.hint.a.y + this.hint.b.y) / 2 };
    const c = this.renderer.cam;
    c.x += (mid.x - c.x) * 0.6;
    c.y += (mid.y - c.y) * 0.6;
    this.renderer.clampCamera();
  }

  // ---------------------------------------------------------------- tutorial

  private setupTutorial(): void {
    this.tutorialStep = 0;
    this.tutorialHold = 0;
    this.tutorialList = [];
    const ids = this.level?.tutorial;
    if (!ids || this.save.progress.tutorialDone) {
      this.hud.setCoach(null);
      return;
    }
    const steps: Record<string, { head: string; body: string; check: () => boolean }> = {
      draw: {
        head: 'Drag to pave a road',
        body: 'Drag from the green district to the blue one with one finger. Commuters only travel where there is asphalt.',
        check: () => this.net.edges.length > 0,
      },
      deliver: {
        head: 'Watch them commute',
        body: 'Cars are coloured by their destination. Each arrival pays a fare — that money funds the rest of your city.',
        check: () => this.traffic.stats.delivered >= 4,
      },
      tools: {
        head: 'Two fingers to move the map',
        body: 'Pinch to zoom, drag with two fingers to pan. The buttons below switch tools, undo and re-centre the map.',
        check: () => this.traffic.stats.delivered >= 8,
      },
      junction: {
        head: 'Cross roads to make junctions',
        body: 'Draw across an existing road and it becomes a junction. Sharing one route is far cheaper than building two.',
        check: () => this.net.nodes.some((n) => n.edges.length >= 3),
      },
      budget: {
        head: 'Mind the budget',
        body: 'Money at the top is all you have until fares start arriving. The bulldozer refunds a third of a road.',
        check: () => this.traffic.stats.delivered >= 6,
      },
      highway: {
        head: 'Freeways fly over streets',
        body: 'A freeway crosses surface roads without joining them. End it on a street to build a ramp — that is how traffic gets on and off.',
        check: () => this.net.edges.some((e) => e.kind === 'highway'),
      },
    };
    this.tutorialList = ids.map((id) => steps[id]).filter(Boolean);
    this.showTutorialStep();
  }

  private showTutorialStep(): void {
    const step = this.tutorialList[this.tutorialStep];
    if (!step) {
      this.hud.setCoach(null);
      this.save.progress.tutorialDone = true;
      this.save.persist();
      return;
    }
    this.hud.setCoach(step.head, step.body, () => {
      this.tutorialStep = this.tutorialList.length;
      this.hud.setCoach(null);
      this.save.progress.tutorialDone = true;
      this.save.persist();
    });
  }

  private updateTutorial(dt: number): void {
    const step = this.tutorialList[this.tutorialStep];
    if (!step) return;
    if (step.check()) {
      this.tutorialHold += dt;
      if (this.tutorialHold > 0.8) {
        this.tutorialHold = 0;
        this.tutorialStep++;
        this.showTutorialStep();
        this.audio.star(0);
      }
    } else {
      this.tutorialHold = 0;
    }
  }

  // ------------------------------------------------------------------ scoring

  private finish(won: boolean, reason: LevelResult['reason']): void {
    if (this.state === 'over') return;
    const level = this.level;
    if (!level) return;
    this.state = 'over';
    this.input.enabled = false;
    this.stroke = null;
    this.ghost = null;
    this.hud.setCoach(null);
    const st = this.traffic.stats;

    let stars = 0;
    if (won) {
      stars = 1;
      if (st.peakJam <= 0.5) stars = 2;
      if (st.peakJam <= 0.25 && (!level.par?.commute || this.avgCommute() <= level.par.commute)) stars = 3;
    }
    const netStats = this.net.stats();
    const score =
      this.mode === 'campaign'
        ? Math.max(
            0,
            Math.round(st.delivered * 10 + stars * 900 + this.earned * 0.6 - this.spent * 0.05 + (won ? 500 : 0)),
          )
        : Math.round(st.delivered + this.earned * 0.2);

    const result: LevelResult = {
      won,
      reason,
      delivered: st.delivered,
      goal: level.goal.deliver,
      stars,
      cost: Math.round(this.spent),
      earned: Math.round(this.earned),
      time: this.elapsed,
      avgCommute: this.avgCommute(),
      bestCombo: st.bestCombo,
      roadsBuilt: this.roadsBuilt,
      roadLength: Math.round(netStats.length),
      peakCars: st.peakCars,
      peakJam: st.peakJam,
      score,
    };
    this.lastResult = result;

    // lifetime stats
    const s = this.save.stats;
    s.delivered += st.delivered;
    s.moneySpent += this.spent;
    s.moneyEarned += this.earned;
    if (won) s.levelsCompleted++;
    else if (reason !== 'quit') s.levelsFailed++;
    if (reason === 'gridlock') s.jams++;

    if (this.mode === 'campaign') {
      this.save.recordLevel(level.id, { stars, score, time: this.elapsed, cost: this.spent });
      if (won) {
        const idx = levelIndex(level.id);
        const chap = LEVELS[idx + 1]?.chapter ?? level.chapter;
        this.save.progress.unlockedChapter = Math.max(this.save.progress.unlockedChapter, chap);
      }
      this.audio.stopAmbient();
      if (won) this.audio.win();
      else this.audio.lose();
    } else if (this.mode === 'endless') {
      const best = this.save.addEndless({
        seed: level.seed,
        score,
        delivered: st.delivered,
        time: this.elapsed,
        difficulty: level.difficulty ?? 0,
        date: Date.now(),
      });
      void best;
      this.audio.stopAmbient();
      this.audio.lose();
    } else if (this.mode === 'daily') {
      this.save.setDaily(dailySeed(), score, st.delivered);
      const today = dailySeed();
      if (this.save.stats.dailyLast !== today) {
        const y = new Date(Date.now() - 86400000);
        const ySeed = dailySeed(y);
        this.save.stats.dailyStreak = this.save.stats.dailyLast === ySeed ? this.save.stats.dailyStreak + 1 : 1;
        this.save.stats.dailyLast = today;
      }
      this.audio.stopAmbient();
      this.audio.lose();
    } else {
      this.audio.stopAmbient();
    }
    this.save.persist();
    this.hud.show(false);
    this.openScreen('results');
    if (won) haptic([18, 40, 18]);
  }

  // -------------------------------------------------------------------- misc

  private onDeliver(car: Car, fare: number, combo: number, zoneName?: string): void {
    if (this.attract) return;
    this.money += fare;
    this.earned += fare;
    this.save.stats.moneyEarned += fare;
    const zone = this.demand.zones[car.toZone];
    if (zone) {
      this.renderer.pop(zone.x, zone.y, zone.color, 12);
      if (!this.save.settings.reduceMotion) this.renderer.spark(zone.x, zone.y, zone.color, 4);
    }
    if (combo >= 6 && combo - this.comboShown >= 6) {
      this.comboShown = combo;
      this.renderer.coin(car.x, car.y - 10, `${combo}× streak!`, '#ffe08a');
      this.audio.coin();
    } else if (fare > 0) {
      this.renderer.coin(car.x, car.y - 8, `+${Math.max(1, Math.round(fare))}`);
    }
    this.audio.deliver(combo);
    if (combo % 25 === 0) haptic(14);
    void zoneName;
  }

  private hover(p: Vec2 | null): void {
    if (!p || this.state !== 'playing' || !this.net) {
      this.hoverEdgeId = -1;
      return;
    }
    if (this.tool === 'inspect' || this.tool === 'bulldoze') {
      const e = this.net.edgeAt(p.x, p.y, 14);
      this.hoverEdgeId = e?.id ?? -1;
    } else {
      this.hoverEdgeId = -1;
    }
  }

  private panBy(dxScreen: number, dyScreen: number): void {
    const c = this.renderer.cam;
    c.x -= dxScreen / c.zoom;
    c.y -= dyScreen / c.zoom;
    this.renderer.clampCamera();
  }

  private key(k: string, ev: KeyboardEvent): void {
    if (ev.repeat && k !== 'ArrowLeft' && k !== 'ArrowRight' && k !== 'ArrowUp' && k !== 'ArrowDown') return;
    const pan = 60 / this.renderer.cam.zoom;
    switch (k) {
      case '1':
        this.setTool('street');
        break;
      case '2':
        if (this.toolsAvailable().avenue) this.setTool('avenue');
        break;
      case '3':
        if (this.toolsAvailable().highway) this.setTool('highway');
        break;
      case 'x':
        this.setTool('bulldoze');
        break;
      case 'q':
        if (this.toolsAvailable().zone) this.setTool('zone');
        break;
      case 'z':
        if (ev.shiftKey) this.redo();
        else this.undo();
        break;
      case 'y':
        this.redo();
        break;
      case 'h':
        this.useHint();
        break;
      case 'f':
        this.renderer.fitCamera();
        this.audio.click();
        break;
      case 'r':
        if (this.state === 'playing' || this.state === 'paused') this.restart();
        break;
      case 'g':
        this.setSetting('gridSnap', !this.save.settings.gridSnap);
        break;
      case 's':
        this.cycleSpeed();
        break;
      case 'm':
        this.setSetting('muted', !this.save.settings.muted);
        break;
      case 'S':
        if (this.mode === 'sandbox') this.saveSandbox();
        break;
      case '=':
      case '+':
        this.renderer.zoomAt(this.renderer.vw / 2, this.renderer.vh / 2, 1.25);
        break;
      case '-':
      case '_':
        this.renderer.zoomAt(this.renderer.vw / 2, this.renderer.vh / 2, 1 / 1.25);
        break;
      case 'ArrowLeft':
        this.panBy(-pan, 0);
        break;
      case 'ArrowRight':
        this.panBy(pan, 0);
        break;
      case 'ArrowUp':
        this.panBy(0, -pan);
        break;
      case 'ArrowDown':
        this.panBy(0, pan);
        break;
      case 'Escape':
        if (this.screens.open) {
          if (this.screens.current === 'pause') this.resume();
          else this.backScreen();
        } else if (this.state === 'playing') this.pause();
        break;
      case 'Space':
        if (this.state === 'playing' || this.state === 'paused') this.togglePause();
        break;
      default:
        break;
    }
  }

  setSetting<K extends keyof Settings>(key: K, value: Settings[K]): void {
    (this.save.settings as Settings)[key] = value;
    this.save.persist();
    this.applySettings();
    this.audio.click();
    if (this.screens.open) this.screens.show(this.screens.current, this.screenCtx());
  }

  private applySettings(): void {
    const s = this.save.settings;
    document.body.classList.toggle('reduce-motion', s.reduceMotion);
    this.audio.applySettings({ master: !s.muted, sfx: s.sfx, music: s.music });
    this.renderer.quality = s.quality;
    this.renderer.markRoadsDirty();
  }

  toast(msg: string, kind: '' | 'good' | 'bad' = ''): void {
    const t = el('div', { class: `toast ${kind}`, text: msg });
    this.toasts.appendChild(t);
    window.setTimeout(() => t.remove(), 2400);
    while (this.toasts.childElementCount > 3) this.toasts.firstElementChild?.remove();
  }

  /** Save button lives in the sandbox HUD long-press menu; exposed for keys. */
  requestSandboxSave(): void {
    this.saveSandbox();
  }

  /**
   * Headless test hooks — used by `npm run smoke`, which drives a full game
   * against a mock canvas and asserts that no NaN ever reaches a draw call.
   */
  get debug(): {
    tick: (now: number) => void;
    start: (id: string) => void;
    stroke: (pts: Vec2[], kind?: RoadKind) => void;
    tool: (t: ToolId) => void;
    state: () => GameState;
    result: () => LevelResult | null;
    bulldoze: (p: Vec2) => void;
    undo: () => void;
    redo: () => void;
    saveSandbox: () => void;
    endless: (seed: string, d: number) => void;
    sandbox: (seed: string, size: number) => void;
  } {
    return {
      tick: (now) => this.tick(now),
      start: (id) => {
        this.prepareCampaign(id);
        this.beginLevel();
      },
      stroke: (pts, kind) => {
        if (kind) this.tool = kind;
        this.buildRoad(pts.map((p) => ({ ...p })));
      },
      tool: (t) => this.setTool(t),
      state: () => this.state,
      result: () => this.lastResult,
      bulldoze: (p) => this.bulldozeAt(p),
      undo: () => this.undo(),
      redo: () => this.redo(),
      saveSandbox: () => this.saveSandbox(),
      endless: (seed, d) => this.startEndless(seed, d),
      sandbox: (seed, size) => this.startSandbox(seed, size),
    };
  }

  destroy(): void {
    cancelAnimationFrame(this.rafId);
    this.input?.destroy();
  }
}

type ToolSpecLike = NonNullable<LevelDef['tools']>;

export { formatNumber, formatMoney };
