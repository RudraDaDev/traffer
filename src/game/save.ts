/** Persistence: settings, campaign progress, lifetime stats, sandbox worlds. */

import { load, rawGet, rawRemove, save, keysWith, wipeAll, mergeDefaults } from '../core/storage';
import { STORAGE_KEYS } from './config';
import {
  defaultProgress,
  defaultSettings,
  defaultStats,
  type EndlessRecord,
  type ProgressData,
  type SandboxSave,
  type Settings,
  type StatsData,
} from './types';

export interface SandboxMeta {
  id: string;
  name: string;
  seed: string;
  size: number;
  savedAt: number;
  roads: number;
  zones: number;
  delivered: number;
}

export class SaveData {
  settings: Settings = { ...defaultSettings };
  progress: ProgressData = defaultProgress();
  stats: StatsData = defaultStats();
  endless: EndlessRecord[] = [];
  daily: Record<string, { score: number; delivered: number }> = {};

  load(): void {
    this.settings = mergeDefaults(defaultSettings, load<Partial<Settings>>(STORAGE_KEYS.settings, {}));
    this.progress = mergeDefaults(defaultProgress(), load<Partial<ProgressData>>(STORAGE_KEYS.progress, {}));
    this.stats = mergeDefaults(defaultStats(), load<Partial<StatsData>>(STORAGE_KEYS.stats, {}));
    this.endless = load<EndlessRecord[]>(STORAGE_KEYS.endless, []);
    if (!Array.isArray(this.endless)) this.endless = [];
    this.daily = load<Record<string, { score: number; delivered: number }>>('daily', {});
    if (!this.daily || typeof this.daily !== 'object') this.daily = {};
  }

  persist(): void {
    save(STORAGE_KEYS.settings, this.settings);
    save(STORAGE_KEYS.progress, this.progress);
    save(STORAGE_KEYS.stats, this.stats);
    save(STORAGE_KEYS.endless, this.endless.slice(0, 25));
    save('daily', this.daily);
  }

  resetAll(): void {
    wipeAll();
    this.settings = { ...defaultSettings };
    this.progress = defaultProgress();
    this.stats = defaultStats();
    this.endless = [];
    this.daily = {};
  }

  // ------------------------------------------------------------------ records

  get endlessBest(): number {
    return this.endless.reduce((a, r) => Math.max(a, r.score), 0);
  }

  addEndless(rec: EndlessRecord): boolean {
    this.endless.push(rec);
    this.endless.sort((a, b) => b.score - a.score);
    this.endless = this.endless.slice(0, 25);
    const best = this.endless[0]?.score ?? 0;
    if (best > this.stats.endlessBest) {
      this.stats.endlessBest = best;
      return true;
    }
    return false;
  }

  dailyScore(seed: string): number {
    return this.daily[seed]?.score ?? 0;
  }

  setDaily(seed: string, score: number, delivered: number): boolean {
    const prev = this.daily[seed]?.score ?? 0;
    if (score <= prev) return false;
    this.daily[seed] = { score, delivered };
    return true;
  }

  recordLevel(
    id: string,
    res: { stars: number; score: number; time: number; cost: number },
  ): { newBest: boolean; starsGained: number } {
    const cur = this.progress.campaign[id] ?? { stars: 0, bestScore: 0, bestTime: 0, lowestCost: 0, completed: 0 };
    const starsGained = Math.max(0, res.stars - cur.stars);
    const next = {
      stars: Math.max(cur.stars, res.stars),
      bestScore: Math.max(cur.bestScore, res.score),
      bestTime: cur.bestTime > 0 && res.time > 0 ? (cur.bestTime <= res.time ? cur.bestTime : res.time) : res.time,
      lowestCost: cur.lowestCost > 0 ? Math.min(cur.lowestCost, res.cost) : res.cost,
      completed: cur.completed + (res.stars > 0 ? 1 : 0),
    };
    this.progress.campaign[id] = next;
    this.progress.totalStars = Object.values(this.progress.campaign).reduce((a, b) => a + b.stars, 0);
    return { newBest: res.score > cur.bestScore && cur.bestScore > 0, starsGained };
  }

  // ----------------------------------------------------------------- sandbox

  sandboxIndex(): SandboxMeta[] {
    const raw = rawGet(STORAGE_KEYS.sandboxIndex);
    if (!raw) return [];
    try {
      const list = JSON.parse(raw) as SandboxMeta[];
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  private writeIndex(list: SandboxMeta[]): void {
    save(STORAGE_KEYS.sandboxIndex, list.slice(0, 24));
  }

  saveSandbox(world: SandboxSave): boolean {
    const ok = save(STORAGE_KEYS.sandboxSave(world.id), world);
    if (!ok) return false;
    const list = this.sandboxIndex();
    const meta: SandboxMeta = {
      id: world.id,
      name: world.name,
      seed: world.seed,
      size: world.size,
      savedAt: world.savedAt,
      roads: world.edges.length,
      zones: world.zones.length,
      delivered: world.delivered,
    };
    const i = list.findIndex((x) => x.id === world.id);
    if (i >= 0) list[i] = meta;
    else list.unshift(meta);
    this.writeIndex(list);
    return true;
  }

  loadSandbox(id: string): SandboxSave | null {
    return load<SandboxSave | null>(STORAGE_KEYS.sandboxSave(id), null);
  }

  deleteSandbox(id: string): void {
    rawRemove(STORAGE_KEYS.sandboxSave(id));
    this.writeIndex(this.sandboxIndex().filter((x) => x.id !== id));
  }

  sandboxSaves(): SandboxSave[] {
    const out: SandboxSave[] = [];
    for (const key of keysWith('sandbox.')) {
      if (key === STORAGE_KEYS.sandboxIndex) continue;
      const s = this.loadSandbox(key.slice('sandbox.'.length));
      if (s) out.push(s);
    }
    out.sort((a, b) => b.savedAt - a.savedAt);
    return out;
  }
}
