/**
 * Headless screenshot: plays a level with the reference planner, then exports
 * the canvas as SVG -> PNG so the visuals can actually be inspected.
 *
 *   npm run shot -- g3            desktop 1280x800
 *   npm run shot -- g3 mobile     phone portrait 390x844
 *   npm run shot -- m5 wide 120   any level, any sim seconds
 */

import { writeFileSync, mkdirSync } from 'node:fs';
import { JSDOM } from 'jsdom';
import sharp from 'sharp';
import { makeRecordingContext, type RecordedCanvas } from './svgcanvas';

const args = process.argv.slice(2);
const levelId = args[0] ?? 'g3';
const preset = args[1] ?? 'desktop';
const seconds = parseInt(args[2] ?? '90', 10);

const SIZE: Record<string, [number, number]> = {
  desktop: [1280, 800],
  mobile: [390, 844],
  landscape: [844, 390],
};
const [W, H] = SIZE[preset] ?? SIZE.desktop;

const dom = new JSDOM('<!doctype html><html><body><div id="app"></div></body></html>', {
  pretendToBeVisual: true,
  url: 'http://localhost/',
});
const win = dom.window as unknown as Record<string, unknown> & {
  HTMLCanvasElement: { prototype: HTMLCanvasElement };
  document: Document;
};
win.HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement) {
  return makeRecordingContext(this);
} as unknown as HTMLCanvasElement['getContext'];

const g = globalThis as unknown as Record<string, unknown>;
const define = (k: string, v: unknown) => Object.defineProperty(g, k, { value: v, configurable: true, writable: true });
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
define('requestAnimationFrame', (cb: FrameRequestCallback) => setTimeout(() => cb(Date.now()), 16));
define('cancelAnimationFrame', (id: number) => clearTimeout(id));
define('devicePixelRatio', preset === 'mobile' ? 2 : 1);
define('confirm', () => true);
define('innerWidth', W);
define('innerHeight', H);
define('matchMedia', (q: string) => ({ matches: preset === 'mobile' ? /hover: none/.test(q) : false, media: q }));
(win as unknown as { innerWidth: number }).innerWidth = W;
(win as unknown as { innerHeight: number }).innerHeight = H;
(win as unknown as { matchMedia: unknown }).matchMedia = g.matchMedia;

async function main(): Promise<void> {
  const { Game } = await import('../game/game');
  const { autoConnect } = await import('../game/solver');
  const { RNG } = await import('../core/rng');

  const app = win.document.getElementById('app') as HTMLElement;
  const game = new Game(app);
  const dbg = game.debug;
  dbg.start(levelId);

  // play like the reference bot so the picture has roads and traffic in it
  const level = game.level!;
  const kinds = (['street', 'avenue', 'highway'] as const).filter((k) =>
    k === 'street' ? true : (level.tools as Record<string, boolean> | undefined)?.[k],
  );
  autoConnect(game.net, game.demand.zones, level.goal.budget, new RNG(level.seed + '-shot'), [...kinds]);
  game.demand.updateAnchors();
  (game.renderer as unknown as { markRoadsDirty: () => void }).markRoadsDirty();

  let now = 0;
  const tick = (n: number) => {
    for (let i = 0; i < n; i++) {
      now += 16.7;
      dbg.tick(now);
    }
  };
  (game as unknown as { speedIdx: number }).speedIdx = 3;
  tick(Math.ceil((seconds * 60) / 3 / 4));
  (game as unknown as { speedIdx: number }).speedIdx = 1;
  tick(4);

  // frame the whole map, then record exactly one clean frame
  game.renderer.fitCamera(0.96);
  if (args.includes('near')) {
    game.renderer.cam.zoom = Math.min(game.renderer.maxZoom, game.renderer.fitZoom * 2.6);
    const e0 = game.net.edges[0];
    if (e0) {
      const mid = e0.pts[Math.floor(e0.pts.length / 2)];
      game.renderer.cam.x = mid.x;
      game.renderer.cam.y = mid.y;
    }
    game.renderer.clampCamera();
    tick(1);
  }
  if (args.includes('night')) {
    (game as unknown as { night: number }).night = 0.85;
  }
  const canvas = game.canvas as unknown as RecordedCanvas;
  canvas.__rec.length = 0;
  tick(1);
  const rec = canvas.__rec ?? [];
  let svg = `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}"><defs>${(
    canvas.__defs ?? []
  ).join('')}</defs><rect width="100%" height="100%" fill="#0b1015"/>${rec.join('')}</svg>`;

  // rasterise the ImageData layers (terrain) into data URLs
  for (const img of canvas.__images ?? []) {
    const png = await sharp(Buffer.from(img.data.buffer, img.data.byteOffset, img.data.byteLength), {
      raw: { width: img.w, height: img.h, channels: 4 },
    })
      .resize({ width: Math.min(img.w, 1100) })
      .png({ palette: true, quality: 78, effort: 6 })
      .toBuffer();
    svg = svg.split(`data-token="${img.token}"`).join(`href="data:image/png;base64,${png.toString('base64')}"`);
  }

  mkdirSync('shots', { recursive: true });
  const base = `shots/${levelId}-${preset}`;
  writeFileSync(base + '.svg', svg);
  await sharp(Buffer.from(svg), { density: 96 }).png().toFile(base + '.png');

  console.log(
    `${base}.png  ${canvas.width}x${canvas.height}  roads=${game.net.edges.length}  cars=${game.traffic.cars.length}  delivered=${game.traffic.stats.delivered}  svg=${(
      svg.length / 1024
    ).toFixed(0)}kb`,
  );
  dom.window.close();
}

void main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
