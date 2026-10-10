/** Splash progress. The inline script in index.html owns the counter. */

export function bootProgress(pct: number, label?: string): void {
  const w = globalThis as unknown as {
    __trafferBooted?: boolean;
    __trafferProgress?: (p: number, label?: string) => void;
  };
  if (w.__trafferBooted) return;
  try {
    w.__trafferProgress?.(pct, label);
  } catch {
    /* splash is optional */
  }
}

export function bootFailed(message: string): void {
  const w = globalThis as unknown as { __trafferFail?: (m: string) => void };
  try {
    w.__trafferFail?.(message);
  } catch {
    /* ignore */
  }
}
