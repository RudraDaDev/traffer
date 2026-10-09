/** Tiny DOM helpers. */

export type ElProps<K extends keyof HTMLElementTagNameMap> = Omit<Partial<HTMLElementTagNameMap[K]>, 'style'> & {
  class?: string;
  text?: string;
  html?: string;
  style?: Partial<CSSStyleDeclaration>;
};

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: ElProps<K>,
  children?: (Node | string | null | undefined)[],
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props) {
    for (const [k, val] of Object.entries(props)) {
      if (val === undefined || val === null) continue;
      if (k === 'class') node.className = String(val);
      else if (k === 'text') node.textContent = String(val);
      else if (k === 'html') node.innerHTML = String(val);
      else if (k === 'style' && typeof val === 'object') Object.assign(node.style, val as Partial<CSSStyleDeclaration>);
      else if (k.startsWith('on') && typeof val === 'function') {
        node.addEventListener(k.slice(2).toLowerCase(), val as EventListener);
      } else if (k === 'dataset' && typeof val === 'object') {
        Object.assign(node.dataset, val as object);
      } else {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (node as any)[k] = val;
      }
    }
  }
  if (children) {
    for (const c of children) {
      if (c === null || c === undefined) continue;
      node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    }
  }
  return node;
}

export function clear(node: Element): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function on<K extends keyof WindowEventMap>(
  target: Window | Document | HTMLElement,
  type: K,
  handler: (ev: WindowEventMap[K]) => void,
  opts?: AddEventListenerOptions,
): () => void {
  target.addEventListener(type as string, handler as EventListener, opts);
  return () => target.removeEventListener(type as string, handler as EventListener, opts);
}

/** rAF-driven counter animation for score screens. */
export function tweenNumber(
  node: HTMLElement,
  from: number,
  to: number,
  duration: number,
  fmt: (n: number) => string,
): void {
  const start = performance.now();
  const step = (now: number) => {
    const t = Math.min(1, (now - start) / duration);
    const e = 1 - Math.pow(1 - t, 3);
    node.textContent = fmt(from + (to - from) * e);
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

export function isTouchDevice(): boolean {
  return typeof window !== 'undefined' && (window.matchMedia?.('(hover: none)').matches || 'ontouchstart' in window);
}

export function isMobileUA(): boolean {
  if (typeof navigator === 'undefined') return false;
  return /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(navigator.userAgent);
}
