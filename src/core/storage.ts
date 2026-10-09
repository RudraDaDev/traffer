/** Typed localStorage wrapper with versioning + graceful degradation. */

const PREFIX = 'traffer.v1.';

let available = true;
let memoryFallback: Record<string, string> = {};

try {
  const probe = PREFIX + '__probe__';
  localStorage.setItem(probe, '1');
  localStorage.removeItem(probe);
} catch {
  available = false;
}

export function rawGet(key: string): string | null {
  const k = PREFIX + key;
  if (!available) return memoryFallback[k] ?? null;
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
}

export function rawSet(key: string, value: string): boolean {
  const k = PREFIX + key;
  if (!available) {
    memoryFallback[k] = value;
    return true;
  }
  try {
    localStorage.setItem(k, value);
    return true;
  } catch {
    // Quota exceeded: drop the oldest sandbox saves and retry once.
    try {
      const doomed: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const kk = localStorage.key(i);
        if (kk && kk.startsWith(PREFIX + 'sandbox.')) doomed.push(kk);
      }
      doomed.sort();
      if (doomed.length) localStorage.removeItem(doomed[0]);
      localStorage.setItem(k, value);
      return true;
    } catch {
      return false;
    }
  }
}

export function rawRemove(key: string): void {
  const k = PREFIX + key;
  if (!available) {
    delete memoryFallback[k];
    return;
  }
  try {
    localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

export function load<T>(key: string, fallback: T): T {
  const s = rawGet(key);
  if (!s) return fallback;
  try {
    const parsed = JSON.parse(s) as T;
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

export function save<T>(key: string, value: T): boolean {
  try {
    return rawSet(key, JSON.stringify(value));
  } catch {
    return false;
  }
}

export function keysWith(prefix: string): string[] {
  const out: string[] = [];
  const full = PREFIX + prefix;
  if (!available) {
    for (const k of Object.keys(memoryFallback)) if (k.startsWith(full)) out.push(k.slice(PREFIX.length));
    return out;
  }
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(full)) out.push(k.slice(PREFIX.length));
    }
  } catch {
    /* ignore */
  }
  return out;
}

export function wipeAll(): void {
  if (!available) {
    memoryFallback = {};
    return;
  }
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) doomed.push(k);
    }
    for (const k of doomed) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
}

export function storageOK(): boolean {
  return available;
}

/** Deep-merge a saved object onto defaults so new fields never break old saves. */
export function mergeDefaults<T extends object>(defaults: T, saved: unknown): T {
  if (!saved || typeof saved !== 'object') return structuredCloneSafe(defaults);
  const out: Record<string, unknown> = { ...(defaults as Record<string, unknown>) };
  const s = saved as Record<string, unknown>;
  for (const key of Object.keys(out)) {
    if (!(key in s)) continue;
    const dv = out[key];
    const sv = s[key];
    if (dv && typeof dv === 'object' && !Array.isArray(dv) && sv && typeof sv === 'object' && !Array.isArray(sv)) {
      out[key] = mergeDefaults(dv as object, sv);
    } else if (typeof dv === typeof sv) {
      out[key] = sv;
    }
  }
  return out as T;
}

export function structuredCloneSafe<T>(o: T): T {
  return JSON.parse(JSON.stringify(o)) as T;
}
