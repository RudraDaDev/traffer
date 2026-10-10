/**
 * Procedural audio: every sound is synthesised at runtime with the WebAudio
 * API, so the game ships zero binary assets and stays tiny.
 */

type Ctx = AudioContext & { _unlocked?: boolean };

export interface AudioSettings {
  master: boolean;
  sfx: number; // 0..1
  music: number; // 0..1
}

export const defaultAudioSettings: AudioSettings = { master: true, sfx: 0.75, music: 0.4 };

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);

export class Audio {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private ambient: { osc: OscillatorNode[]; gain: GainNode; filter: BiquadFilterNode } | null = null;
  private noiseBuf: AudioBuffer | null = null;
  settings: AudioSettings = { ...defaultAudioSettings };
  private lastPlay = new Map<string, number>();

  get ready(): boolean {
    return !!this.ctx;
  }

  /** Must be called from a user gesture on iOS/Safari. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const AC: typeof AudioContext =
        window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AC) return;
      const ctx = new AC() as Ctx;
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.settings.master ? 0.9 : 0;
      this.master.connect(ctx.destination);

      this.sfxBus = ctx.createGain();
      this.sfxBus.gain.value = this.settings.sfx;
      this.sfxBus.connect(this.master);

      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = this.settings.music;
      this.musicBus.connect(this.master);

      // 1 second of white noise, reused by every noisy effect.
      const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate), ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.noiseBuf = buf;

      if (ctx.state === 'suspended') void ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  applySettings(s: AudioSettings): void {
    this.settings = { ...s };
    if (!this.ctx || !this.master || !this.sfxBus || !this.musicBus) return;
    const now = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(s.master ? 0.9 : 0, now, 0.05);
    this.sfxBus.gain.setTargetAtTime(clamp01(s.sfx), now, 0.05);
    this.musicBus.gain.setTargetAtTime(clamp01(s.music), now, 0.05);
  }

  /** Throttle repeated identical sounds (e.g. per-car honks). */
  private allow(key: string, minGapMs: number): boolean {
    const now = performance.now();
    const prev = this.lastPlay.get(key) ?? -1e9;
    if (now - prev < minGapMs) return false;
    this.lastPlay.set(key, now);
    return true;
  }

  private tone(opts: {
    freq: number;
    to?: number;
    dur: number;
    type?: OscillatorType;
    gain?: number;
    delay?: number;
    attack?: number;
    bus?: 'sfx' | 'music';
    detune?: number;
  }): void {
    if (!this.ctx || !this.sfxBus || !this.musicBus) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = opts.type ?? 'sine';
    osc.frequency.setValueAtTime(Math.max(20, opts.freq), t0);
    if (opts.to && opts.to !== opts.freq) osc.frequency.exponentialRampToValueAtTime(Math.max(20, opts.to), t0 + opts.dur);
    if (opts.detune) osc.detune.setValueAtTime(opts.detune, t0);
    const peak = opts.gain ?? 0.2;
    const atk = opts.attack ?? 0.006;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + atk);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    osc.connect(g);
    g.connect(opts.bus === 'music' ? this.musicBus : this.sfxBus);
    osc.start(t0);
    osc.stop(t0 + opts.dur + 0.05);
  }

  private noise(opts: {
    dur: number;
    gain?: number;
    filter?: BiquadFilterType;
    freq?: number;
    to?: number;
    q?: number;
    delay?: number;
  }): void {
    if (!this.ctx || !this.sfxBus || !this.noiseBuf) return;
    const ctx = this.ctx;
    const t0 = ctx.currentTime + (opts.delay ?? 0);
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = opts.filter ?? 'bandpass';
    f.frequency.setValueAtTime(opts.freq ?? 900, t0);
    if (opts.to) f.frequency.exponentialRampToValueAtTime(Math.max(40, opts.to), t0 + opts.dur);
    f.Q.value = opts.q ?? 1;
    const g = ctx.createGain();
    const peak = opts.gain ?? 0.14;
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(peak, t0 + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + opts.dur);
    src.connect(f);
    f.connect(g);
    g.connect(this.sfxBus);
    src.start(t0);
    src.stop(t0 + opts.dur + 0.05);
  }

  // ---------------------------------------------------------------- effects

  click(): void {
    if (!this.allow('click', 40)) return;
    this.tone({ freq: 620, to: 880, dur: 0.05, type: 'triangle', gain: 0.09 });
  }

  hover(): void {
    if (!this.allow('hover', 60)) return;
    this.tone({ freq: 1180, dur: 0.03, type: 'sine', gain: 0.03 });
  }

  back(): void {
    this.tone({ freq: 460, to: 260, dur: 0.09, type: 'triangle', gain: 0.09 });
  }

  /** Road paving: filtered gravel + a soft low thump. */
  pave(scale = 1): void {
    this.noise({ dur: 0.22, gain: 0.055 * scale, filter: 'bandpass', freq: 620, to: 1500, q: 0.8 });
    this.tone({ freq: 150, to: 92, dur: 0.16, type: 'sine', gain: 0.09 * scale });
  }

  bulldoze(): void {
    if (!this.allow('bulldoze', 70)) return;
    this.noise({ dur: 0.2, gain: 0.1, filter: 'lowpass', freq: 900, to: 180 });
    this.tone({ freq: 110, to: 62, dur: 0.16, type: 'sawtooth', gain: 0.05 });
  }

  denied(): void {
    if (!this.allow('denied', 140)) return;
    this.tone({ freq: 190, to: 130, dur: 0.16, type: 'square', gain: 0.06 });
  }

  snap(): void {
    if (!this.allow('snap', 60)) return;
    this.tone({ freq: 1500, dur: 0.025, type: 'sine', gain: 0.035 });
  }

  /** A commuter arrives: short bright bell whose pitch rises with combo. */
  deliver(combo = 0): void {
    if (!this.allow('deliver', 45)) return;
    const base = 660 * Math.pow(2, Math.min(12, combo) / 24);
    this.tone({ freq: base, dur: 0.09, type: 'sine', gain: 0.075 });
    this.tone({ freq: base * 1.5, dur: 0.12, type: 'sine', gain: 0.035, delay: 0.02 });
  }

  coin(): void {
    if (!this.allow('coin', 90)) return;
    this.tone({ freq: 990, dur: 0.05, type: 'square', gain: 0.035 });
    this.tone({ freq: 1320, dur: 0.09, type: 'square', gain: 0.03, delay: 0.045 });
  }

  honk(): void {
    if (!this.allow('honk', 420)) return;
    this.tone({ freq: 430, dur: 0.14, type: 'sawtooth', gain: 0.03 });
    this.tone({ freq: 545, dur: 0.14, type: 'sawtooth', gain: 0.024, delay: 0.01 });
  }

  alarm(): void {
    if (!this.allow('alarm', 900)) return;
    this.tone({ freq: 740, to: 520, dur: 0.22, type: 'triangle', gain: 0.075 });
    this.tone({ freq: 740, to: 520, dur: 0.22, type: 'triangle', gain: 0.075, delay: 0.26 });
  }

  win(): void {
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      this.tone({ freq: f, dur: 0.42, type: 'triangle', gain: 0.11, delay: i * 0.1 });
      this.tone({ freq: f * 2, dur: 0.3, type: 'sine', gain: 0.04, delay: i * 0.1 + 0.01 });
    });
    this.noise({ dur: 0.5, gain: 0.03, filter: 'highpass', freq: 3000, delay: 0.4 });
  }

  lose(): void {
    const notes = [392, 349.23, 293.66, 220];
    notes.forEach((f, i) => this.tone({ freq: f, dur: 0.5, type: 'sawtooth', gain: 0.075, delay: i * 0.14 }));
  }

  star(i: number): void {
    this.tone({ freq: 700 * Math.pow(1.26, i), to: 1050 * Math.pow(1.26, i), dur: 0.3, type: 'sine', gain: 0.1 });
  }

  // ---------------------------------------------------------------- ambient

  /** Low city hum + slow filtered noise bed. Cheap: 3 nodes total. */
  startAmbient(): void {
    if (!this.ctx || !this.musicBus || !this.noiseBuf || this.ambient) return;
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0.0001;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 380;
    filter.Q.value = 0.7;
    const src = ctx.createBufferSource();
    src.buffer = this.noiseBuf;
    src.loop = true;
    src.connect(filter);
    filter.connect(gain);

    const oscs: OscillatorNode[] = [];
    for (const [f, det] of [
      [55, 0],
      [82.4, 6],
      [110, -8],
    ] as [number, number][]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f;
      o.detune.value = det;
      const og = ctx.createGain();
      og.gain.value = 0.05;
      o.connect(og);
      og.connect(gain);
      o.start();
      oscs.push(o);
    }
    gain.connect(this.musicBus);
    src.start();
    gain.gain.setTargetAtTime(0.16, ctx.currentTime, 1.4);
    this.ambient = { osc: oscs, gain, filter };
  }

  stopAmbient(): void {
    if (!this.ctx || !this.ambient) return;
    const a = this.ambient;
    this.ambient = null;
    a.gain.gain.setTargetAtTime(0.0001, this.ctx.currentTime, 0.4);
    const oscs = a.osc;
    window.setTimeout(() => oscs.forEach((o) => { try { o.stop(); } catch { /* already stopped */ } }), 1200);
  }

  /** Ambient reacts to how jammed the city is — subtle but effective. */
  setTension(t: number): void {
    if (!this.ambient || !this.ctx) return;
    const now = this.ctx.currentTime;
    this.ambient.filter.frequency.setTargetAtTime(380 - 200 * clamp01(t), now, 0.6);
    this.ambient.gain.gain.setTargetAtTime(0.16 + 0.1 * clamp01(t), now, 0.8);
  }

  suspend(): void {
    if (this.ctx && this.ctx.state === 'running') void this.ctx.suspend();
  }

  resume(): void {
    if (this.ctx && this.ctx.state === 'suspended') void this.ctx.resume();
  }
}
