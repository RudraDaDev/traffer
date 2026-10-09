/** Tiny UI widget kit + the whole icon set (inline SVG, no assets). */

import { el } from '../core/dom';

const P: Record<string, string> = {
  street: 'M5 21L9.5 3M19 21L14.5 3M12 21v-3M12 14.5v-3.5M12 7.5V4',
  avenue:
    'M3 21L8 3M21 21L16 3M10.6 21v-2.4M10.6 15.4v-3M10.6 9.2V6.6M13.4 21v-2.4M13.4 15.4v-3M13.4 9.2V6.6',
  highway: 'M2 16c5.5 0 7-7 12-7s5.5 3 8 3M7.5 16v5M14.5 9.2V21M4 16h16',
  bridge: 'M2 18h20M3 18c4.5 0 5.5-8 9-8s4.5 8 9 8M7 18v3M17 18v3',
  bulldoze: 'M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13.5h9L17.5 7M10 11h4',
  zone: 'M12 5v14M5 12h14',
  undo: 'M9.5 14.5L4 9l5.5-5.5M4 9h10.5a5.5 5.5 0 010 11H11',
  redo: 'M14.5 14.5L20 9l-5.5-5.5M20 9H9.5a5.5 5.5 0 000 11H13',
  zoomIn: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20.5 20.5L16.2 16.2M11 8v6M8 11h6',
  zoomOut: 'M11 18a7 7 0 100-14 7 7 0 000 14zM20.5 20.5L16.2 16.2M8 11h6',
  fit: 'M4 9.5V4h5.5M20 9.5V4h-5.5M4 14.5V20h5.5M20 14.5V20h-5.5',
  play: 'M8 5.2l11 6.8-11 6.8z',
  pause: 'M8.5 5v14M15.5 5v14',
  fast: 'M4 6.2l7 5.8-7 5.8zM13 6.2l7 5.8-7 5.8z',
  gear: 'M12 9.2A2.8 2.8 0 1012 14.8 2.8 2.8 0 0012 9.2zM12 2.6l1.2 2.5 2.7-.5.6 2.7 2.5 1.2-1.4 2.4 1.4 2.4-2.5 1.2-.6 2.7-2.7-.5L12 21.4l-1.2-2.5-2.7.5-.6-2.7L5 15.5l1.4-2.4L5 10.7l2.5-1.2.6-2.7 2.7.5z',
  home: 'M3.5 11.2L12 4l8.5 7.2V20a1 1 0 01-1 1h-4.6v-6.2H9.1V21H4.5a1 1 0 01-1-1z',
  star: 'M12 2.8l2.9 5.9 6.5.9-4.7 4.6 1.1 6.5-5.8-3.1-5.8 3.1 1.1-6.5L2.6 9.6l6.5-.9z',
  bulb: 'M9.2 18.2h5.6M10.4 21h3.2M12 3a6.2 6.2 0 00-3.6 11.2c.5.4.9 1 1 1.6h5.2c.1-.6.5-1.2 1-1.6A6.2 6.2 0 0012 3z',
  car: 'M4.6 16.4l1.6-5.2a2.2 2.2 0 012.1-1.6h7.4a2.2 2.2 0 012.1 1.6l1.6 5.2v3.2h-2.6v-1.5H7.2v1.5H4.6zM7 13.6h10',
  coin: 'M12 21a9 9 0 100-18 9 9 0 000 18zM14.4 8.6c-.6-.7-1.5-1-2.5-1-1.4 0-2.4.7-2.4 1.8 0 2.6 5.1 1.3 5.1 4 0 1.2-1.1 2-2.6 2-1.1 0-2-.4-2.6-1.1M12 6.2v11.6',
  clock: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 7v5.3l3.3 2',
  close: 'M6 6l12 12M18 6L6 18',
  back: 'M15 4.5L7.5 12 15 19.5',
  lock: 'M6 11h12v9.5H6zM9 11V7.8a3 3 0 016 0V11',
  chart: 'M4 20.5V11M10 20.5V4M16 20.5v-6.5M21.5 20.5h-19',
  infinity: 'M6.2 16.2c-2.3 0-4.2-1.9-4.2-4.2s1.9-4.2 4.2-4.2c3.2 0 4.6 8.4 7.8 8.4 2.3 0 4.2-1.9 4.2-4.2s-1.9-4.2-4.2-4.2c-3.2 0-4.6 8.4-7.8 8.4z',
  calendar: 'M4.5 6.5h15v14h-15zM4.5 11h15M8.5 3.5v4M15.5 3.5v4',
  save: 'M5 3.5h11l3.5 3.5v13.5H5zM8.5 3.5v5h7v-5M8.5 20.5v-6h7v6',
  trash: 'M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13.5h9L17.5 7',
  refresh: 'M20.5 12a8.5 8.5 0 11-2.6-6.1M20.5 4v4.5H16',
  trophy: 'M7 4h10v5.2a5 5 0 01-10 0zM7 5.8H4v1a3.2 3.2 0 003.2 3.2M17 5.8h3v1a3.2 3.2 0 01-3.2 3.2M9.2 20.5h5.6M12 14.2v6.3',
  sound: 'M4 9.2v5.6h3.8L13 19.5V4.5L7.8 9.2zM16.4 9a4.2 4.2 0 010 6M19 6.4a7.8 7.8 0 010 11.2',
  mute: 'M4 9.2v5.6h3.8L13 19.5V4.5L7.8 9.2zM16.5 9.5l5 5M21.5 9.5l-5 5',
  check: 'M4.5 12.5l5 5 10-11',
  grid: 'M3.5 9h17M3.5 15h17M9 3.5v17M15 3.5v17',
  info: 'M12 21a9 9 0 100-18 9 9 0 000 18zM12 11v5.5M12 7.6v.1',
  hand: 'M8 13.5V5.8a1.6 1.6 0 013.2 0v6m0-1.4a1.6 1.6 0 013.2 0v1.2m0-.6a1.6 1.6 0 013.2 0v4.6a6.4 6.4 0 01-6.4 6.4h-.6a6.4 6.4 0 01-6.4-6.4v-2.6a1.6 1.6 0 013.2 0v1.4',
  flag: 'M6 21V3.8h12l-2.4 4.2L18 12.2H6',
  route: 'M6.5 8.5a3 3 0 100-6 3 3 0 000 6zM17.5 21.5a3 3 0 100-6 3 3 0 000 6zM6.5 8.5V13a5.5 5.5 0 005.5 5.5h5.5',
  layers: 'M12 3.5l8.5 4.6L12 12.7 3.5 8.1zM3.5 12.6L12 17.2l8.5-4.6M3.5 16.9L12 21.5l8.5-4.6',
  warn: 'M12 3.6l9 15.8H3zM12 9.6v4.6M12 16.8v.1',
  eye: 'M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12zM12 9.4a2.6 2.6 0 100 5.2 2.6 2.6 0 000-5.2z',
  users: 'M8.5 11.5a3.5 3.5 0 100-7 3.5 3.5 0 000 7zM2.5 20.5v-1.6a4.4 4.4 0 014.4-4.4h3.2a4.4 4.4 0 014.4 4.4v1.6M16.5 4.8a3.5 3.5 0 010 6.7M18 14.8a4.4 4.4 0 013.5 4.3v1.4',
  bolt: 'M13.5 2.5L4.8 13.4h6L10 21.5l9-11.2h-6.2z',
  seed: 'M12 21c0-6 3-9 8-9 0 5-3 9-8 9zM12 21c0-4.5-2.2-6.8-6.5-6.8 0 3.8 2.2 6.8 6.5 6.8zM12 21V9',
};

const SOLID = new Set(['star', 'play', 'pause', 'fast', 'bolt']);

export function icon(name: keyof typeof P | string, cls = ''): HTMLElement {
  const path = P[name] ?? P.info;
  const host = el('span', { class: 'icohost' });
  host.innerHTML = `<svg class="ico ${SOLID.has(name) ? 'solid' : ''} ${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"/></svg>`;
  return host.firstElementChild as HTMLElement;
}

export function btn(
  label: string,
  opts: {
    icon?: string;
    variant?: '' | 'primary' | 'teal' | 'danger' | 'ghost';
    big?: boolean;
    block?: boolean;
    disabled?: boolean;
    title?: string;
    onClick?: (ev: MouseEvent) => void;
  } = {},
): HTMLButtonElement {
  const b = el('button', {
    class: `btn ${opts.variant ?? ''} ${opts.big ? 'big' : ''} ${opts.block ? 'block' : ''}`,
    type: 'button',
  });
  if (opts.title) b.title = opts.title;
  if (opts.disabled) b.disabled = true;
  if (opts.icon) b.appendChild(icon(opts.icon));
  if (label) b.appendChild(el('span', { text: label }));
  if (opts.onClick) b.addEventListener('click', opts.onClick);
  return b;
}

export function iconBtn(
  iconName: string,
  opts: { title?: string; on?: boolean; disabled?: boolean; cls?: string; onClick?: (ev: MouseEvent) => void } = {},
): HTMLButtonElement {
  const b = el('button', { class: `iconbtn ${opts.on ? 'on' : ''} ${opts.cls ?? ''}`, type: 'button' });
  if (opts.title) {
    b.title = opts.title;
    b.setAttribute('aria-label', opts.title);
  }
  if (opts.disabled) b.disabled = true;
  b.appendChild(icon(iconName));
  if (opts.onClick) b.addEventListener('click', opts.onClick);
  return b;
}

export function chip(iconName: string | null, valueNode: HTMLElement, cls = ''): HTMLElement {
  const c = el('div', { class: `chip ${cls}` });
  if (iconName) c.appendChild(icon(iconName));
  c.appendChild(valueNode);
  return c;
}

export function stars(n: number, max = 3, big = false): HTMLElement {
  const s = el('div', { class: `stars ${big ? 'big' : ''}` });
  for (let i = 0; i < max; i++) {
    const ic = icon('star');
    if (i < n) {
      ic.classList.add('lit');
      ic.style.animationDelay = `${i * 0.16}s`;
    }
    s.appendChild(ic);
  }
  return s;
}

export function bar(cls = ''): { root: HTMLElement; fill: HTMLElement; set: (v: number) => void } {
  const root = el('div', { class: `bar ${cls}` });
  const fill = el('i');
  root.appendChild(fill);
  return {
    root,
    fill,
    set: (v: number) => {
      fill.style.width = `${Math.max(0, Math.min(1, v)) * 100}%`;
    },
  };
}

export function toggle(
  initial: boolean,
  onChange: (v: boolean) => void,
): { root: HTMLButtonElement; set: (v: boolean) => void } {
  const root = el('button', { class: `switch ${initial ? 'on' : ''}`, type: 'button' });
  root.setAttribute('role', 'switch');
  root.setAttribute('aria-checked', String(initial));
  root.addEventListener('click', () => {
    const v = !root.classList.contains('on');
    root.classList.toggle('on', v);
    root.setAttribute('aria-checked', String(v));
    onChange(v);
  });
  return {
    root,
    set: (v: boolean) => {
      root.classList.toggle('on', v);
      root.setAttribute('aria-checked', String(v));
    },
  };
}

export function slider(
  min: number,
  max: number,
  step: number,
  value: number,
  onInput: (v: number) => void,
): HTMLInputElement {
  const s = el('input', { type: 'range' }) as HTMLInputElement;
  s.min = String(min);
  s.max = String(max);
  s.step = String(step);
  s.value = String(value);
  s.addEventListener('input', () => onInput(parseFloat(s.value)));
  return s;
}

export function seg<T extends string>(
  options: { id: T; label: string }[],
  current: T,
  onPick: (id: T) => void,
): { root: HTMLElement; set: (id: T) => void } {
  const root = el('div', { class: 'seg' });
  const btns = new Map<T, HTMLButtonElement>();
  for (const o of options) {
    const b = el('button', { type: 'button', text: o.label, class: o.id === current ? 'on' : '' });
    b.addEventListener('click', () => {
      set(o.id);
      onPick(o.id);
    });
    btns.set(o.id, b);
    root.appendChild(b);
  }
  function set(id: T): void {
    for (const [k, b] of btns) b.classList.toggle('on', k === id);
  }
  return { root, set };
}

export function statBox(value: string, label: string): HTMLElement {
  return el('div', { class: 'stat' }, [el('div', { class: 'v', text: value }), el('div', { class: 'k', text: label })]);
}

export function panel(cls = ''): HTMLElement {
  return el('div', { class: `panel ${cls}` });
}

/** Small haptic pulse where supported. */
export function haptic(pattern: number | number[] = 12, strong = false): void {
  try {
    const nav = navigator as Navigator & { vibrate?: (p: number | number[]) => boolean };
    if (nav.vibrate) nav.vibrate(strong && typeof pattern === 'number' ? [pattern, 30, pattern] : pattern);
  } catch {
    /* not supported */
  }
}
