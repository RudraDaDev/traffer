/**
 * Headless smoke test.
 *
 * Boots the real Game inside jsdom with a mock 2D context that *throws* on any
 * non-finite argument, then plays a scripted session: attract mode, a campaign
 * level, road building, bulldozing, undo/redo, a win, an endless run, a sandbox
 * save/load round trip and every overlay screen.
 *
 *   npm run smoke
 */

import { JSDOM } from 'jsdom';

let drawCalls = 0;

function checkArgs(name: string, args: unknown[]): void {
  for (const a of args) {
    if (typeof a === 'number' && !Number.isFinite(a)) {
      throw new Error(`ctx.${name} received a non-finite number: [${args.map(String).join(', ')}]`);
    }
  }
}

function makeCtx(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const store: Record<string | symbol, unknown> = {
    canvas,
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    globalAlpha: 1,
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    lineCap: 'butt',
    lineJoin: 'miter',
    globalCompositeOperation: 'source-over',
    lineDashOffset: 0,
    imageSmoothingEnabled: true,
    filter: 'none',
  };
  const gradient = { addColorStop: () => undefined };
  const known: Record<string, (...a: unknown[]) => unknown> = {
    createImageData: (w: unknown, h: unknown) => {
      const ww = Math.max(1, Math.floor(Number(w)));
      const hh = Math.max(1, Math.floor(Number(h)));
      return { width: ww, height: hh, data: new Uint8ClampedArray(ww * hh * 4) };
    },
    createRadialGradient: () => gradient,
    createLinearGradient: () => gradient,
    createPattern: () => null,
    measureText: (t: unknown) => ({ width: String(t).length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 }),
    getImageData: (_x: unknown, _y: unknown, w: unknown, h: unknown) => known.createImageData(w, h),
    drawImage: (img: unknown, ...rest: unknown[]) => {
      const im = img as HTMLCanvasElement | null;
      if (!im || typeof (im as HTMLCanvasElement).width !== 'number') throw new Error('drawImage: bad source');
      if ((im as HTMLCanvasElement).width <= 0) throw new Error('drawImage: zero-width source');
      checkArgs('drawImage', rest);
      drawCalls++;
    },
  };

  return new Proxy(store, {
    get(target, prop) {
      if (prop in target) return target[prop as string];
      if (typeof prop === 'symbol') return undefined;
      if (known[prop]) return known[prop];
      // everything else is a drawing method
      return (...args: unknown[]) => {
        checkArgs(prop, args);
        drawCalls++;
        if (prop === 'setLineDash' && !Array.isArray(args[0])) throw new Error('setLineDash needs an array');
        return undefined;
      };
    },
    set(target, prop, value) {
      if (typeof value === 'number' && !Number.isFinite(value)) {
        throw new Error(`ctx.${String(prop)} was set to a non-finite number: ${value}`);
      }
      if ((prop === 'lineWidth' || prop === 'globalAlpha') && typeof value === 'number' && value < 0) {
        throw new Error(`ctx.${String(prop)} was set negative: ${value}`);
      }
      target[prop as string] = value;
      return true;
    },
  }) as unknown as CanvasRenderingContext2D;
}

// ------------------------------------------------------------------- jsdom

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
  pretendToBeVisual: true,
  url: 'http://localhost/',
});
const win = dom.window as unknown as Record<string, unknown> & {
  HTMLCanvasElement: { prototype: HTMLCanvasElement };
  document: Document;
};
win.HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
  return makeCtx(this);
} as unknown as HTMLCanvasElement['getContext'];

const g = globalThis as unknown as Record<string, unknown>;
const define = (key: string, value: unknown): void => {
  Object.defineProperty(g, key, { value, configurable: true, writable: true });
};
define('window', win);
define('document', win.document);
define('navigator', win.navigator);
define('localStorage', win.localStorage);
define('HTMLElement', win.HTMLElement);
define('Element', win.Element);
define('Node', win.Node);
define('Event', win.Event);
define('MouseEvent', win.MouseEvent);
define('KeyboardEvent', win.KeyboardEvent);
define('PointerEvent', win.MouseEvent);
define('getComputedStyle', win.getComputedStyle);
const raf = (win.requestAnimationFrame as typeof requestAnimationFrame) ??
  ((cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16) as unknown as number);
const caf = (win.cancelAnimationFrame as typeof cancelAnimationFrame) ?? ((id: number) => clearTimeout(id));
define('requestAnimationFrame', raf);
define('cancelAnimationFrame', caf);
define('devicePixelRatio', 1);
define('confirm', () => true);
define('ResizeObserver', undefined);

// -------------------------------------------------------------------- test

const results: string[] = [];
let failures = 0;

function step(name: string, fn: () => void): void {
  try {
    fn();
    results.push(`  ok   ${name}`);
  } catch (err) {
    failures++;
    results.push(`  FAIL ${name}: ${(err as Error).message}`);
    if (process.env.VERBOSE) console.error(err);
  }
}

async function main(): Promise<void> {
  const { Game } = await import('../game/game');
  const { LEVELS } = await import('../game/levels');
  const app = win.document.getElementById('app') as HTMLElement;

  const game = new Game(app);
  const dbg = game.debug;
  let now = 0;
  const frames = (n: number, ms = 16.7) => {
    for (let i = 0; i < n; i++) {
      now += ms;
      dbg.tick(now);
    }
  };

  step('boot + attract mode renders', () => frames(90));

  step('open every overlay screen', () => {
    for (const s of ['levels', 'settings', 'help', 'stats', 'sandbox', 'endless', 'menu'] as const) {
      game.openScreen(s);
      frames(2);
    }
  });

  step('start campaign level 1 and build a road', () => {
    dbg.start('g1');
    frames(30);
    const level = game.level!;
    const a = { x: level.zones[0].x * level.size, y: level.zones[0].y * level.size };
    const b = { x: level.zones[1].x * level.size, y: level.zones[1].y * level.size };
    const stroke = [];
    for (let i = 0; i <= 14; i++) stroke.push({ x: a.x + ((b.x - a.x) * i) / 14, y: a.y + ((b.y - a.y) * i) / 14 + Math.sin(i) * 3 });
    dbg.stroke(stroke);
    if (game.net.edges.length < 1) throw new Error('no road was built');
    if (game.money >= level.goal.budget) throw new Error('money was not deducted');
  });

  const setSpeed = (idx: number) => {
    (game as unknown as { speedIdx: number }).speedIdx = idx;
  };

  step('simulate ~70 s of traffic and deliver commuters', () => {
    setSpeed(3);
    frames(1400);
    if (game.traffic.stats.delivered < 3) throw new Error(`only ${game.traffic.stats.delivered} delivered`);
    if (game.traffic.stats.cars < 1) throw new Error('no commuters on the road');
  });

  step('undo and redo restore the network', () => {
    const before = game.net.edges.length;
    const money = game.money;
    dbg.undo();
    if (game.net.edges.length >= before) throw new Error('undo did not remove roads');
    dbg.redo();
    if (game.net.edges.length !== before) throw new Error('redo did not restore roads');
    if (Math.abs(game.money - money) > 1) throw new Error('money drifted across undo/redo');
  });

  step('avenue upgrade replaces the street (level with avenues unlocked)', () => {
    dbg.start('g6');
    frames(4);
    const level = game.level!;
    const a = { x: level.zones[0].x * level.size, y: level.zones[0].y * level.size };
    const b = { x: level.zones[2].x * level.size, y: level.zones[2].y * level.size };
    dbg.stroke([a, { x: b.x, y: a.y }, b], 'street');
    const pts = game.net.edges[0].pts.map((p) => ({ ...p }));
    const streetsBefore = game.net.edges.filter((x) => x.kind === 'street').length;
    dbg.stroke(pts, 'avenue');
    const streetsAfter = game.net.edges.filter((x) => x.kind === 'street').length;
    if (!game.net.edges.some((x) => x.kind === 'avenue')) throw new Error('no avenue created');
    if (streetsAfter >= streetsBefore) throw new Error('the old street was not consumed');
  });

  step('a locked road type is refused', () => {
    dbg.start('g1');
    frames(4);
    const level = game.level!;
    const a = { x: level.zones[0].x * level.size, y: level.zones[0].y * level.size };
    const b = { x: level.zones[1].x * level.size, y: level.zones[1].y * level.size };
    dbg.stroke([a, b], 'avenue');
    if (game.net.edges.some((x) => x.kind === 'avenue')) throw new Error('avenue should be locked on level 1');
    dbg.stroke([a, { x: b.x, y: a.y }, b], 'street');
    frames(600);
  });

  step('bulldoze refunds and removes', () => {
    const e = game.net.edges[0];
    const mid = e.pts[Math.floor(e.pts.length / 2)];
    const money = game.money;
    const n = game.net.edges.length;
    dbg.bulldoze(mid);
    if (game.net.edges.length >= n) throw new Error('nothing was bulldozed');
    if (game.money <= money) throw new Error('no refund');
    dbg.undo();
  });

  step('win the level and score it', () => {
    const goal = game.level!.goal.deliver;
    (game.traffic.stats as { delivered: number }).delivered = goal - 1;
    const z = game.demand.zones[0];
    frames(2);
    // force the last delivery through the real code path
    const car = game.traffic.cars[0];
    if (car) {
      car.toZone = z.id;
      car.path = [];
    }
    (game.traffic.stats as { delivered: number }).delivered = goal;
    frames(4);
    setSpeed(1);
    const res = dbg.result();
    if (!res) throw new Error('no result recorded');
    if (!res.won) throw new Error('level did not register as won');
    if (res.stars < 1) throw new Error('no stars awarded');
    if (game.screens.current !== 'results') throw new Error('results screen not shown');
  });

  step('progress was persisted', () => {
    if ((game.save.progress.campaign['g1']?.stars ?? 0) < 1) throw new Error('stars not saved');
    if (game.save.stats.delivered <= 0) throw new Error('stats not updated');
  });

  step('gridlock ends a level', () => {
    dbg.start('g7');
    setSpeed(3);
    frames(10);
    const level = game.level!;
    const a = { x: level.zones[0].x * level.size, y: level.zones[0].y * level.size };
    const b = { x: level.zones[3].x * level.size, y: level.zones[3].y * level.size };
    dbg.stroke([a, { x: (a.x + b.x) / 2, y: a.y }, b]);
    frames(200);
    (game.traffic.stats as { jam: number }).jam = 2;
    frames(4);
    const res = dbg.result();
    if (!res || res.reason !== 'gridlock') throw new Error(`expected gridlock, got ${res?.reason}`);
  });

  step('endless run boots and ramps', () => {
    dbg.endless('SMOKE1', 3);
    frames(120);
    if (!game.net) throw new Error('no network');
    if (game.state !== 'playing') throw new Error('not playing');
  });

  step('daily challenge boots', () => {
    game.openScreen('menu');
    game.startDaily();
    frames(60);
    if (game.mode !== 'daily') throw new Error('wrong mode');
  });

  step('sandbox: place a district, build, save, load', () => {
    dbg.sandbox('SMOKEBOX', 900);
    frames(30);
    dbg.tool('zone');
    (game as unknown as { placeZonePublic?: never });
    const size = game.level!.size;
    // place through the same code path the pointer uses
    (game as unknown as Record<string, (p: { x: number; y: number }) => void>)['placeZone']({ x: size * 0.3, y: size * 0.3 });
    const zones = game.demand.zones.length;
    if (zones < 1) throw new Error('no district placed');
    dbg.tool('street');
    dbg.stroke([
      { x: size * 0.3, y: size * 0.3 },
      { x: size * 0.7, y: size * 0.3 },
      { x: size * 0.7, y: size * 0.7 },
    ]);
    frames(60);
    dbg.saveSandbox();
    const idx = game.save.sandboxIndex();
    if (!idx.length) throw new Error('sandbox not indexed');
    game.loadSandbox(idx[0].id);
    frames(30);
    if (game.net.edges.length < 1) throw new Error('sandbox roads were not restored');
    if (game.demand.zones.length !== zones) throw new Error('sandbox districts were not restored');
  });

  step('every campaign level generates and accepts a road', () => {
    for (const l of LEVELS) {
      dbg.start(l.id);
      frames(2);
      const a = { x: l.zones[0].x * l.size, y: l.zones[0].y * l.size };
      const b = { x: l.zones[1].x * l.size, y: l.zones[1].y * l.size };
      dbg.stroke([a, { x: b.x, y: a.y }, b]);
      if (game.net.edges.length < 1) throw new Error(`${l.id}: could not build the first road`);
      frames(6);
    }
  });

  step('settings round-trip', () => {
    game.setSetting('gridSnap', false);
    game.setSetting('quality', 'low');
    game.setSetting('reduceMotion', true);
    frames(10);
    if (game.save.settings.quality !== 'low') throw new Error('setting not applied');
    game.setSetting('quality', 'auto');
    game.setSetting('reduceMotion', false);
  });

  console.log(results.join('\n'));
  console.log(`\n${results.length - failures}/${results.length} checks passed · ${drawCalls.toLocaleString()} draw calls validated`);
  if (failures) {
    process.exitCode = 1;
  }
  dom.window.close();
}

void main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
