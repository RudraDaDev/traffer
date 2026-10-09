/**
 * A recording 2D context that serialises every draw call to SVG.
 *
 * It exists so the headless tooling can produce real pictures of the game —
 * terrain, roads, districts, traffic — without a browser. It also refuses
 * non-finite numbers, exactly like the smoke test's mock.
 */

interface Mat {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

const ID: Mat = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

function mul(m: Mat, n: Mat): Mat {
  return {
    a: m.a * n.a + m.c * n.b,
    b: m.b * n.a + m.d * n.b,
    c: m.a * n.c + m.c * n.d,
    d: m.b * n.c + m.d * n.d,
    e: m.a * n.e + m.c * n.f + m.e,
    f: m.b * n.e + m.d * n.f + m.f,
  };
}

function matStr(m: Mat): string {
  return `matrix(${r(m.a)} ${r(m.b)} ${r(m.c)} ${r(m.d)} ${r(m.e)} ${r(m.f)})`;
}

function r(n: number): string {
  return Math.round(n * 1000) / 1000 + '';
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export interface RecordedCanvas {
  __rec: string[];
  __defs: string[];
  __images: { token: string; data: Uint8ClampedArray; w: number; h: number }[];
  width: number;
  height: number;
}

let gradientId = 0;

interface Gradient {
  kind: 'radial' | 'linear';
  coords: number[];
  stops: { o: number; c: string }[];
  id: string;
}

export function makeRecordingContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const rec = canvas as unknown as RecordedCanvas;
  rec.__rec = [];
  rec.__defs = [];
  rec.__images = [];

  const state = {
    m: { ...ID } as Mat,
    fillStyle: '#000' as unknown,
    strokeStyle: '#000' as unknown,
    lineWidth: 1,
    globalAlpha: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    font: '10px sans-serif',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    gco: 'source-over',
    dash: [] as number[],
    dashOffset: 0,
  };
  const stack: (typeof state)[] = [];
  let path = '';
  let pathOpen = false;

  const emit = (s: string) => rec.__rec.push(s);
  const finite = (name: string, args: unknown[]) => {
    for (const a of args) {
      if (typeof a === 'number' && !Number.isFinite(a)) throw new Error(`ctx.${name}: non-finite arg [${args}]`);
    }
  };

  const paint = (which: 'fill' | 'stroke', style: unknown, extra: string): string => {
    if (style && typeof style === 'object') {
      const g = ((style as { __g?: Gradient }).__g ?? style) as Gradient;
      if (!g.stops) return `${which}="#000" ${extra}`;
      const stops = g.stops.map((s) => `<stop offset="${s.o}" stop-color="${esc(s.c)}"/>`).join('');
      if (g.kind === 'radial') {
        rec.__defs.push(
          `<radialGradient id="${g.id}" gradientUnits="userSpaceOnUse" cx="${r(g.coords[2])}" cy="${r(g.coords[3])}" r="${r(
            g.coords[4],
          )}" fx="${r(g.coords[0])}" fy="${r(g.coords[1])}">${stops}</radialGradient>`,
        );
      } else {
        rec.__defs.push(
          `<linearGradient id="${g.id}" gradientUnits="userSpaceOnUse" x1="${r(g.coords[0])}" y1="${r(g.coords[1])}" x2="${r(
            g.coords[2],
          )}" y2="${r(g.coords[3])}">${stops}</linearGradient>`,
        );
      }
      return `${which}="url(#${g.id})" ${extra}`;
    }
    return `${which}="${esc(String(style))}" ${extra}`;
  };

  const blend = () =>
    state.gco === 'source-over'
      ? ''
      : ` style="mix-blend-mode:${state.gco === 'lighter' ? 'screen' : state.gco === 'multiply' ? 'multiply' : state.gco}"`;

  const api: Record<string, unknown> = {
    canvas,
    get globalAlpha() {
      return state.globalAlpha;
    },
    set globalAlpha(v: number) {
      finite('globalAlpha', [v]);
      state.globalAlpha = v;
    },
    get lineWidth() {
      return state.lineWidth;
    },
    set lineWidth(v: number) {
      finite('lineWidth', [v]);
      if (v < 0) throw new Error('negative lineWidth');
      state.lineWidth = v;
    },
    get fillStyle() {
      return state.fillStyle;
    },
    set fillStyle(v: unknown) {
      state.fillStyle = v;
    },
    get strokeStyle() {
      return state.strokeStyle;
    },
    set strokeStyle(v: unknown) {
      state.strokeStyle = v;
    },
    get font() {
      return state.font;
    },
    set font(v: string) {
      state.font = v;
    },
    get textAlign() {
      return state.textAlign;
    },
    set textAlign(v: string) {
      state.textAlign = v;
    },
    get textBaseline() {
      return state.textBaseline;
    },
    set textBaseline(v: string) {
      state.textBaseline = v;
    },
    get lineCap() {
      return state.lineCap;
    },
    set lineCap(v: string) {
      state.lineCap = v;
    },
    get lineJoin() {
      return state.lineJoin;
    },
    set lineJoin(v: string) {
      state.lineJoin = v;
    },
    get lineDashOffset() {
      return state.dashOffset;
    },
    set lineDashOffset(v: number) {
      state.dashOffset = v;
    },
    get globalCompositeOperation() {
      return state.gco;
    },
    set globalCompositeOperation(v: string) {
      state.gco = v;
    },
    get imageSmoothingEnabled() {
      return true;
    },
    set imageSmoothingEnabled(_v: boolean) {
      /* noop */
    },
    save() {
      stack.push({ ...state, m: { ...state.m }, dash: [...state.dash] });
    },
    restore() {
      const s = stack.pop();
      if (s) Object.assign(state, s);
    },
    setTransform(a: number, b: number, c: number, d: number, e: number, f: number) {
      finite('setTransform', [a, b, c, d, e, f]);
      state.m = { a, b, c, d, e, f };
    },
    transform(a: number, b: number, c: number, d: number, e: number, f: number) {
      state.m = mul(state.m, { a, b, c, d, e, f });
    },
    translate(x: number, y: number) {
      state.m = mul(state.m, { ...ID, e: x, f: y });
    },
    scale(x: number, y: number) {
      state.m = mul(state.m, { ...ID, a: x, d: y });
    },
    rotate(a: number) {
      state.m = mul(state.m, { a: Math.cos(a), b: Math.sin(a), c: -Math.sin(a), d: Math.cos(a), e: 0, f: 0 });
    },
    beginPath() {
      path = '';
      pathOpen = false;
    },
    closePath() {
      path += 'Z';
    },
    moveTo(x: number, y: number) {
      finite('moveTo', [x, y]);
      path += `M${r(x)} ${r(y)}`;
      pathOpen = true;
    },
    lineTo(x: number, y: number) {
      finite('lineTo', [x, y]);
      path += `L${r(x)} ${r(y)}`;
      pathOpen = true;
    },
    quadraticCurveTo(cx: number, cy: number, x: number, y: number) {
      path += `Q${r(cx)} ${r(cy)} ${r(x)} ${r(y)}`;
    },
    bezierCurveTo(c1x: number, c1y: number, c2x: number, c2y: number, x: number, y: number) {
      path += `C${r(c1x)} ${r(c1y)} ${r(c2x)} ${r(c2y)} ${r(x)} ${r(y)}`;
    },
    rect(x: number, y: number, w: number, h: number) {
      path += `M${r(x)} ${r(y)}h${r(w)}v${r(h)}h${r(-w)}Z`;
      pathOpen = true;
    },
    arc(x: number, y: number, rad: number, s: number, e: number, ccw?: boolean) {
      finite('arc', [x, y, rad, s, e]);
      if (rad <= 0) return;
      const steps = Math.max(6, Math.min(48, Math.ceil(Math.abs(e - s) * 8)));
      let a0 = s;
      let a1 = e;
      if (ccw && a1 > a0) a1 -= Math.PI * 2;
      if (!ccw && a1 < a0) a1 += Math.PI * 2;
      for (let i = 0; i <= steps; i++) {
        const t = a0 + ((a1 - a0) * i) / steps;
        const px = x + Math.cos(t) * rad;
        const py = y + Math.sin(t) * rad;
        path += (i === 0 && !pathOpen ? 'M' : i === 0 ? 'L' : 'L') + r(px) + ' ' + r(py);
      }
      pathOpen = true;
    },
    arcTo(x1: number, y1: number, x2: number, y2: number, rad: number) {
      path += `L${r(x1)} ${r(y1)}L${r(x2)} ${r(y2)}`;
      void rad;
    },
    fill() {
      if (!path) return;
      emit(
        `<path d="${path}" ${paint('fill', state.fillStyle, '')} fill-opacity="${r(state.globalAlpha)}" transform="${matStr(
          state.m,
        )}"${blend()}/>`,
      );
    },
    stroke() {
      if (!path) return;
      const dash = state.dash.length ? ` stroke-dasharray="${state.dash.map(r).join(' ')}" stroke-dashoffset="${r(state.dashOffset)}"` : '';
      emit(
        `<path d="${path}" fill="none" ${paint('stroke', state.strokeStyle, '')} stroke-opacity="${r(
          state.globalAlpha,
        )}" stroke-width="${r(state.lineWidth)}" stroke-linecap="${state.lineCap}" stroke-linejoin="${
          state.lineJoin
        }"${dash} transform="${matStr(state.m)}"${blend()}/>`,
      );
    },
    fillRect(x: number, y: number, w: number, h: number) {
      finite('fillRect', [x, y, w, h]);
      emit(
        `<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" ${paint('fill', state.fillStyle, '')} fill-opacity="${r(
          state.globalAlpha,
        )}" transform="${matStr(state.m)}"${blend()}/>`,
      );
    },
    strokeRect(x: number, y: number, w: number, h: number) {
      emit(
        `<rect x="${r(x)}" y="${r(y)}" width="${r(w)}" height="${r(h)}" fill="none" ${paint(
          'stroke',
          state.strokeStyle,
          '',
        )} stroke-width="${r(state.lineWidth)}" stroke-opacity="${r(state.globalAlpha)}" transform="${matStr(state.m)}"/>`,
      );
    },
    clearRect(x: number, y: number, w: number, h: number) {
      rec.__rec.length = 0;
      void x;
      void y;
      void w;
      void h;
    },
    fillText(text: string, x: number, y: number) {
      finite('fillText', [x, y]);
      const anchor = state.textAlign === 'center' ? 'middle' : state.textAlign === 'right' ? 'end' : 'start';
      const m = /(\d+(?:\.\d+)?)px/.exec(state.font);
      const size = m ? parseFloat(m[1]) : 10;
      const weight = /(\d00|bold)/.test(state.font) ? '800' : '600';
      const dy = state.textBaseline === 'middle' ? size * 0.35 : state.textBaseline === 'top' ? size * 0.9 : 0;
      emit(
        `<text x="${r(x)}" y="${r(y + dy)}" font-family="system-ui,sans-serif" font-size="${r(
          size,
        )}" font-weight="${weight}" text-anchor="${anchor}" ${paint('fill', state.fillStyle, '')} fill-opacity="${r(
          state.globalAlpha,
        )}" transform="${matStr(state.m)}">${esc(String(text))}</text>`,
      );
    },
    strokeText(text: string, x: number, y: number) {
      const anchor = state.textAlign === 'center' ? 'middle' : state.textAlign === 'right' ? 'end' : 'start';
      const m = /(\d+(?:\.\d+)?)px/.exec(state.font);
      const size = m ? parseFloat(m[1]) : 10;
      const dy = state.textBaseline === 'middle' ? size * 0.35 : state.textBaseline === 'top' ? size * 0.9 : 0;
      emit(
        `<text x="${r(x)}" y="${r(y + dy)}" font-family="system-ui,sans-serif" font-size="${r(size)}" font-weight="800" text-anchor="${anchor}" fill="none" ${paint(
          'stroke',
          state.strokeStyle,
          '',
        )} stroke-width="${r(state.lineWidth)}" stroke-linejoin="round" transform="${matStr(state.m)}">${esc(
          String(text),
        )}</text>`,
      );
    },
    measureText(t: string) {
      return { width: String(t).length * 6, actualBoundingBoxAscent: 8, actualBoundingBoxDescent: 2 };
    },
    setLineDash(d: number[]) {
      state.dash = Array.isArray(d) ? d : [];
    },
    getLineDash() {
      return state.dash;
    },
    createRadialGradient(x0: number, y0: number, r0: number, x1: number, y1: number, r1: number) {
      const g: Gradient = { kind: 'radial', coords: [x0, y0, x1, y1, r1], stops: [], id: 'g' + gradientId++ };
      void r0;
      return {
        addColorStop(o: number, c: string) {
          g.stops.push({ o, c });
        },
        __g: g,
        toString: () => g.id,
      };
    },
    createLinearGradient(x0: number, y0: number, x1: number, y1: number) {
      const g: Gradient = { kind: 'linear', coords: [x0, y0, x1, y1], stops: [], id: 'g' + gradientId++ };
      return {
        addColorStop(o: number, c: string) {
          g.stops.push({ o, c });
        },
        __g: g,
        toString: () => g.id,
      };
    },
    createPattern() {
      return null;
    },
    createImageData(w: number, h: number) {
      const ww = Math.max(1, Math.floor(w));
      const hh = Math.max(1, Math.floor(h));
      return { width: ww, height: hh, data: new Uint8ClampedArray(ww * hh * 4) };
    },
    getImageData(_x: number, _y: number, w: number, h: number) {
      return (api.createImageData as (a: number, b: number) => unknown)(w, h);
    },
    putImageData(img: { data: Uint8ClampedArray; width: number; height: number }, dx: number, dy: number) {
      finite('putImageData', [dx, dy]);
      const token = 'IMG' + rec.__images.length;
      rec.__images.push({ token, data: img.data, w: img.width, h: img.height });
      rec.__rec.push(
        `<image data-token="${token}" x="${r(dx)}" y="${r(dy)}" width="${img.width}" height="${img.height}"/>`,
      );
    },
    drawImage(img: HTMLCanvasElement, dx: number, dy: number, dw?: number, dh?: number) {
      finite('drawImage', [dx, dy, dw ?? 0, dh ?? 0]);
      const target = img as unknown as RecordedCanvas;
      const w = dw ?? img.width;
      const h = dh ?? img.height;
      if (!target.__rec) {
        emit(`<rect x="${r(dx)}" y="${r(dy)}" width="${r(w)}" height="${r(h)}" fill="#222"/>`);
        return;
      }
      const sx = w / (img.width || 1);
      const sy = h / (img.height || 1);
      emit(
        `<g transform="${matStr(state.m)} translate(${r(dx)} ${r(dy)}) scale(${r(sx)} ${r(sy)})" opacity="${r(
          state.globalAlpha,
        )}">${target.__rec.join('')}</g>`,
      );
      for (const d of target.__defs) rec.__defs.push(d);
      for (const im of target.__images) {
        if (!rec.__images.some((x) => x.token === im.token)) rec.__images.push(im);
      }
    },
  };

  return api as unknown as CanvasRenderingContext2D;
}
