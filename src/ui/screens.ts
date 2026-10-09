/**
 * All overlay screens: main menu, chapter/level browser, briefing, pause,
 * results, settings, help, lifetime stats, endless setup and sandbox manager.
 * Screens are rebuilt from state each time they open — simple, and cheap
 * enough that it never shows.
 */

import { clear, el } from '../core/dom';
import { formatMoney, formatNumber, formatTime } from '../core/math';
import { DISTRICT_COLORS, ROADS, VERSION } from '../game/config';
import {
  CHAPTERS,
  type LevelDef,
  type LevelProgress,
  type LevelResult,
  type ProgressData,
  type Settings,
  type StatsData,
} from '../game/types';
import { LEVELS, LEVEL_BY_ID, levelsForChapter } from '../game/levels';
import { ZONE_NAMES } from '../game/config';
import { btn, icon, iconBtn, panel, seg, slider, statBox, stars, toggle } from './widgets';
import { storageOK } from '../core/storage';
import type { SandboxMeta } from '../game/save';

export type ScreenId =
  | 'none'
  | 'menu'
  | 'levels'
  | 'brief'
  | 'pause'
  | 'results'
  | 'settings'
  | 'help'
  | 'stats'
  | 'sandbox'
  | 'endless';

export interface ScreenCtx {
  progress: ProgressData;
  stats: StatsData;
  settings: Settings;
  level: LevelDef | null;
  result: LevelResult | null;
  chapter: number;
  sandbox: SandboxMeta[];
  endlessBest: number;
  dailyBest: number;
  dailySeed: string;
  dailyDone: boolean;
  nextLevelId: string | null;
  fromScreen: ScreenId;
}

export interface ScreenActions {
  onPlayCampaign(): void;
  onPickLevel(id: string): void;
  onStartLevel(): void;
  onEndless(seed: string, difficulty: number): void;
  onDaily(): void;
  onSandboxNew(seed: string, size: number): void;
  onSandboxLoad(id: string): void;
  onSandboxSave(): void;
  onSandboxDelete(id: string): void;
  onOpen(id: ScreenId): void;
  onBack(): void;
  onResume(): void;
  onRestart(): void;
  onQuit(): void;
  onNext(): void;
  onExitResults(): void;
  onSetting<K extends keyof Settings>(key: K, value: Settings[K]): void;
  onResetProgress(): void;
  onCloseScreens(): void;
}

export class Screens {
  root: HTMLElement;
  current: ScreenId = 'none';
  private actions: ScreenActions;
  private ctx!: ScreenCtx;
  private stack: ScreenId[] = [];

  constructor(actions: ScreenActions) {
    this.actions = actions;
    this.root = el('div', { id: 'screens' });
  }

  get open(): boolean {
    return this.current !== 'none';
  }

  show(id: ScreenId, ctx: ScreenCtx): void {
    this.ctx = ctx;
    if (this.current !== 'none' && this.current !== id) this.stack.push(this.current);
    this.current = id;
    document.body.classList.add('screen-open');
    this.render();
  }

  hide(): void {
    this.current = 'none';
    this.stack = [];
    document.body.classList.remove('screen-open');
    clear(this.root);
  }

  back(): void {
    const prev = this.stack.pop() ?? 'menu';
    this.current = prev;
    this.render();
  }

  private render(): void {
    clear(this.root);
    const screen = el('div', { class: 'screen' });
    const scroll = el('div', { class: 'scroll' });
    screen.appendChild(scroll);
    this.root.appendChild(screen);
    requestAnimationFrame(() => screen.classList.add('in'));

    const content = this.build(this.current);
    if (Array.isArray(content)) scroll.append(...content);
    else if (content) scroll.appendChild(content);

    screen.addEventListener('pointerdown', (ev) => {
      if (ev.target === screen && this.current === 'pause') this.actions.onResume();
    });
  }

  private build(id: ScreenId): HTMLElement | HTMLElement[] | null {
    switch (id) {
      case 'menu':
        return this.menu();
      case 'levels':
        return this.levels();
      case 'brief':
        return this.brief();
      case 'pause':
        return this.pause();
      case 'results':
        return this.results();
      case 'settings':
        return this.settings();
      case 'help':
        return this.help();
      case 'stats':
        return this.statsScreen();
      case 'sandbox':
        return this.sandbox();
      case 'endless':
        return this.endless();
      default:
        return null;
    }
  }

  private head(title: string, sub?: string, backTo?: 'back' | 'close'): HTMLElement {
    const left = backTo
      ? iconBtn(backTo === 'close' ? 'close' : 'back', {
          title: backTo === 'close' ? 'Close' : 'Back',
          onClick: () => (backTo === 'close' ? this.actions.onCloseScreens() : this.actions.onBack()),
        })
      : null;
    const h = el('div', { class: 'row', style: { marginBottom: '12px', gap: '10px' } }, [
      left,
      el('div', { class: 'grow' }, [
        el('h2', { class: 'title', text: title }),
        sub ? el('div', { class: 'subtitle', text: sub }) : null,
      ]),
    ]);
    return h;
  }

  // ------------------------------------------------------------------- menu

  private menu(): HTMLElement {
    const { progress, stats } = this.ctx;
    const wrap = el('div', { class: 'menu' });

    const lastId0 = progress.lastLevel;
    const lastLevel0 = lastId0 ? (LEVEL_BY_ID.get(lastId0) ?? null) : null;
    if (lastLevel0) {
      const cont = btn('', { variant: 'primary', onClick: () => this.actions.onPickLevel(lastLevel0.id) });
      cont.classList.add('menubtn', 'wide');
      cont.style.width = '100%';
      cont.append(
        icon('play'),
        el('div', { class: 'grow', style: { textAlign: 'left' } }, [
          el('div', { class: 't', text: 'Continue' }),
          el('div', { class: 'd', text: `${lastLevel0.name} · ${CHAPTERS[lastLevel0.chapter]?.name ?? 'Campaign'}` }),
        ]),
        stars(progress.campaign[lastLevel0.id]?.stars ?? 0),
      );
      wrap.appendChild(cont);
    }

    const logo = el('div', { class: 'logo' }, [
      el('div', { class: 'mark', text: 'TRAFFER' }),
      el('div', { class: 'tag', text: 'Draw the roads. Keep the city moving.' }),
    ]);
    wrap.appendChild(logo);

    const p = panel();
    const grid = el('div', { class: 'menugrid' });

    const totalStars = LEVELS.reduce((a, l) => a + (progress.campaign[l.id]?.stars ?? 0), 0);
    const done = LEVELS.filter((l) => (progress.campaign[l.id]?.stars ?? 0) > 0).length;

    grid.appendChild(
      menuCard('flag', 'Campaign', `${done}/${LEVELS.length} levels · ${totalStars}★`, 'primary', () =>
        this.actions.onPlayCampaign(),
      ),
    );
    grid.appendChild(
      menuCard('infinity', 'Endless', `Best ${formatNumber(this.ctx.endlessBest)}`, 'teal', () =>
        this.actions.onOpen('endless'),
      ),
    );
    grid.appendChild(
      menuCard(
        'calendar',
        'Daily',
        this.ctx.dailyDone ? `Done · ${formatNumber(this.ctx.dailyBest)}` : `Seed ${this.ctx.dailySeed}`,
        '',
        () => this.actions.onDaily(),
      ),
    );
    grid.appendChild(menuCard('layers', 'Sandbox', 'Free build', '', () => this.actions.onOpen('sandbox')));

    const wide = el('div', { class: 'row', style: { gap: '9px', marginTop: '10px' } }, [
      iconBtn('bulb', { title: 'How to play', onClick: () => this.actions.onOpen('help') }),
      iconBtn('gear', { title: 'Settings', onClick: () => this.actions.onOpen('settings') }),
      iconBtn('chart', { title: 'Your stats', onClick: () => this.actions.onOpen('stats') }),
      el('div', { class: 'grow' }),
      el('div', { class: 'chip' }, [icon('users'), el('b', { text: formatNumber(stats.delivered) })]),
      el('div', { class: 'chip' }, [icon('route'), el('b', { text: `${formatNumber(stats.roadLength / 1000)} km` })]),
    ]);

    p.append(grid, wide);
    wrap.appendChild(p);

    if (!progress.seenHelp) {
      const tip = panel('tight');
      tip.appendChild(
        el('div', { class: 'row', style: { gap: '10px' } }, [
          icon('bulb'),
          el('div', { class: 'grow tiny dim', text: 'First time here? Read the 60-second guide — then jump into First Light.' }),
          btn('Guide', { variant: 'ghost', onClick: () => this.actions.onOpen('help') }),
        ]),
      );
      wrap.appendChild(tip);
    }

    if (!storageOK()) {
      wrap.appendChild(
        el('div', { class: 'foot', text: 'Storage is blocked, so progress will not be saved between sessions.' }),
      );
    }
    wrap.appendChild(el('div', { class: 'foot', text: `TRAFFER v${VERSION} · built for portrait & landscape` }));
    return wrap;
  }

  // ----------------------------------------------------------------- levels

  private levels(): HTMLElement {
    const p = panel();
    const totalStars = LEVELS.reduce((a, l) => a + (this.ctx.progress.campaign[l.id]?.stars ?? 0), 0);
    p.appendChild(
      el('div', { class: 'row between', style: { marginBottom: '10px' } }, [
        this.head2('Campaign', `${totalStars} of ${LEVELS.length * 3} stars`),
        iconBtn('close', { title: 'Menu', onClick: () => this.actions.onBack() }),
      ]),
    );

    const tabs = el('div', { class: 'tabs' });
    const listWrap = el('div');
    const chapter = Math.min(this.ctx.chapter, CHAPTERS.length - 1);

    const drawList = (ch: number) => {
      clear(listWrap);
      const c = CHAPTERS[ch];
      listWrap.appendChild(
        el('div', { class: 'row between', style: { marginTop: '12px', marginBottom: '2px' } }, [
          el('div', { class: 'subtitle', text: c.subtitle }),
          el('div', { class: 'chip' }, [
            icon('star'),
            el('b', {
              text: `${levelsForChapter(ch).reduce((a, l) => a + (this.ctx.progress.campaign[l.id]?.stars ?? 0), 0)}/${
                levelsForChapter(ch).length * 3
              }`,
            }),
          ]),
        ]),
      );
      const grid = el('div', { class: 'levelgrid' });
      levelsForChapter(ch).forEach((l) => {
        const prog = this.ctx.progress.campaign[l.id];
        const globalIdx = LEVELS.findIndex((x) => x.id === l.id);
        const unlocked = globalIdx === 0 || (this.ctx.progress.campaign[LEVELS[globalIdx - 1].id]?.stars ?? 0) > 0;
        const card = el('button', {
          class: `lvlcard ${prog?.stars ? 'done' : ''} ${unlocked ? '' : 'locked'}`,
          type: 'button',
        });
        card.appendChild(el('div', { class: 'no', text: `${globalIdx + 1}`.padStart(2, '0') }));
        card.appendChild(el('div', { class: 'nm', text: l.name }));
        if (unlocked) card.appendChild(stars(prog?.stars ?? 0));
        else card.appendChild(icon('lock', 'lock'));
        if (unlocked) card.addEventListener('click', () => this.actions.onPickLevel(l.id));
        grid.appendChild(card);
      });
      listWrap.appendChild(grid);
    };

    CHAPTERS.forEach((c, i) => {
      const t = el('button', { class: `tab ${i === chapter ? 'on' : ''}`, type: 'button' });
      t.append(el('span', { text: c.name }));
      t.style.borderColor = i === chapter ? c.color : '';
      t.addEventListener('click', () => {
        this.ctx.chapter = i;
        for (const b of tabs.querySelectorAll('.tab')) b.classList.remove('on');
        t.classList.add('on');
        drawList(i);
      });
      tabs.appendChild(t);
    });

    p.append(tabs, listWrap);
    drawList(chapter);
    return p;
  }

  private head2(title: string, sub: string): HTMLElement {
    return el('div', {}, [el('h2', { class: 'title', text: title }), el('div', { class: 'subtitle', text: sub })]);
  }

  // ------------------------------------------------------------------ brief

  private brief(): HTMLElement {
    const l = this.ctx.level;
    if (!l) return this.menu();
    const prog: LevelProgress | undefined = this.ctx.progress.campaign[l.id];
    const p = panel();
    const ch = CHAPTERS[l.chapter] ?? { name: l.mode ?? 'Free play', color: '#9fb3c2', subtitle: '' };

    p.appendChild(
      el('div', { class: 'row between' }, [
        el('div', { class: 'eyebrow', text: ch.name.toUpperCase() }),
        prog?.stars ? stars(prog.stars) : el('div'),
      ]),
    );
    p.appendChild(el('h2', { class: 'title', text: l.name, style: { marginTop: '4px' } }));
    p.appendChild(el('p', { class: 'subtitle', text: l.brief, style: { marginBottom: '12px' } }));

    const chips = el('div', { class: 'row wrap', style: { gap: '7px' } }, [
      chipText('coin', formatMoney(l.goal.budget), 'budget'),
      chipText('users', `${formatNumber(l.goal.deliver)}`, 'to deliver'),
      chipText('zone', `${l.zones.length}`, 'districts'),
      chipText('clock', l.goal.time ? formatTime(l.goal.time) : 'no limit', ''),
      l.goal.jamFails ? chipText('warn', 'gridlock ends it', '') : null,
    ]);
    p.appendChild(chips);

    const tools = el('div', { class: 'legend', style: { marginTop: '14px' } });
    for (const k of ['street', 'avenue', 'highway'] as const) {
      const on = k === 'street' ? true : l.tools?.[k];
      const spec = ROADS[k];
      tools.appendChild(
        el('div', { class: 'it', style: { opacity: on ? '1' : '0.35' } }, [
          icon(k === 'highway' ? 'highway' : k === 'avenue' ? 'avenue' : 'street'),
          el('span', { text: `${spec.name} · $${spec.cost}/m` }),
        ]),
      );
    }
    p.appendChild(tools);

    if (l.par) {
      p.appendChild(
        el('div', { class: 'tiny dim', style: { marginTop: '6px' } }, [
          el('span', {
            text: `★★ spend under ${formatMoney(l.par.cost ?? 0)}   ★★★ average commute under ${l.par.commute ?? 0}s`,
          }),
        ]),
      );
    }

    p.appendChild(
      el('div', { class: 'row', style: { gap: '9px', marginTop: '16px' } }, [
        btn('Back', { variant: 'ghost', onClick: () => this.actions.onBack() }),
        btn('Build', { variant: 'primary', big: true, icon: 'play', onClick: () => this.actions.onStartLevel() }),
      ]),
    );
    return p;
  }

  // ------------------------------------------------------------------ pause

  private pause(): HTMLElement {
    const p = panel('tight');
    p.style.maxWidth = '380px';
    p.style.margin = '0 auto';
    p.appendChild(el('h2', { class: 'title', text: 'Paused' }));
    const l = this.ctx.level;
    if (l) p.appendChild(el('div', { class: 'subtitle', text: `${l.name} — the city keeps running when you resume` }));
    const stack = el('div', { class: 'stack', style: { marginTop: '14px' } }, [
      btn('Resume', { variant: 'primary', icon: 'play', block: true, onClick: () => this.actions.onResume() }),
      btn('Restart level', { icon: 'refresh', block: true, onClick: () => this.actions.onRestart() }),
      el('div', { class: 'row', style: { gap: '9px' } }, [
        btn('Guide', { icon: 'bulb', onClick: () => this.actions.onOpen('help') }),
        btn('Settings', { icon: 'gear', onClick: () => this.actions.onOpen('settings') }),
      ]),
      btn('Quit to menu', { variant: 'ghost', icon: 'home', block: true, onClick: () => this.actions.onQuit() }),
    ]);
    p.appendChild(stack);
    return p;
  }

  // ---------------------------------------------------------------- results

  private results(): HTMLElement {
    const r = this.ctx.result;
    const l = this.ctx.level;
    if (!r || !l) return this.menu();
    const p = panel();
    p.classList.add('result');
    p.style.maxWidth = '460px';
    p.style.margin = '0 auto';

    const won = r.won;
    p.appendChild(
      el('div', {
        class: 'eyebrow',
        text: won ? 'LEVEL COMPLETE' : r.reason === 'gridlock' ? 'GRIDLOCK' : r.reason === 'timeout' ? 'TIME UP' : 'ABANDONED',
        style: { color: won ? 'var(--good)' : 'var(--danger)' },
      }),
    );
    p.appendChild(el('h2', { class: 'title', text: l.name }));
    p.appendChild(stars(r.stars, 3, true));

    if (r.stars > 0) {
      const lines: string[] = ['Goal reached'];
      if (r.stars >= 2) lines.push('Clean traffic — no serious jam');
      if (r.stars >= 3) lines.push('Fast commutes and an efficient network');
      p.appendChild(el('div', { class: 'subtitle', text: lines.join(' · ') }));
    } else if (r.reason === 'gridlock') {
      p.appendChild(
        el('div', {
          class: 'subtitle',
          text: 'The jam meter filled and the city stopped. Add capacity where it hurts: widen the busiest street, or give traffic a second route around the queue.',
        }),
      );
    }

    const grid = el('div', { class: 'statgrid' }, [
      statBox(formatNumber(r.delivered), 'delivered'),
      statBox(formatTime(r.time), 'time'),
      statBox(`${r.avgCommute.toFixed(1)}s`, 'avg commute'),
      statBox(formatMoney(r.cost), 'spent'),
      statBox(formatMoney(r.earned), 'fares'),
      statBox(formatNumber(r.roadLength), 'metres'),
      statBox(formatNumber(r.peakCars), 'peak cars'),
      statBox(`${Math.round(r.peakJam * 100)}%`, 'peak jam'),
    ]);
    p.appendChild(grid);

    p.appendChild(
      el('div', { class: 'row center', style: { marginTop: '12px' } }, [
        el('div', { class: 'chip good' }, [icon('trophy'), el('b', { text: `${formatNumber(r.score)} pts` })]),
      ]),
    );

    const actions = el('div', { class: 'row', style: { gap: '9px', marginTop: '16px' } });
    if (won && this.ctx.nextLevelId) {
      actions.appendChild(btn('Next level', { variant: 'primary', big: true, icon: 'play', onClick: () => this.actions.onNext() }));
    }
    actions.appendChild(btn(won ? 'Replay' : 'Try again', { variant: won ? 'ghost' : 'primary', icon: 'refresh', onClick: () => this.actions.onRestart() }));
    actions.appendChild(
      btn(l.chapter >= 0 ? 'Levels' : 'Menu', {
        variant: 'ghost',
        icon: l.chapter >= 0 ? 'grid' : 'home',
        onClick: () => this.actions.onExitResults(),
      }),
    );
    p.appendChild(actions);
    return p;
  }

  // --------------------------------------------------------------- settings

  private settings(): HTMLElement {
    const p = panel();
    const s = this.ctx.settings;
    p.appendChild(this.head('Settings', 'Tuned for phones and desktops alike', 'back'));

    const set = <K extends keyof Settings>(k: K, v: Settings[K]) => this.actions.onSetting(k, v);

    p.appendChild(
      settingRow('Sound effects', 'Road, traffic and UI sounds', slider(0, 1, 0.05, s.sfx, (v) => set('sfx', v))),
    );
    p.appendChild(settingRow('Ambient city', 'Low traffic hum that reacts to jams', slider(0, 1, 0.05, s.music, (v) => set('music', v))));
    const mute = toggle(s.muted, (v) => set('muted', v));
    p.appendChild(settingRow('Mute everything', 'Silence the whole game', mute.root));
    p.appendChild(settingRow('Haptics', 'Small vibrations on builds and deliveries', toggle(s.haptics, (v) => set('haptics', v)).root));

    p.appendChild(el('hr', { class: 'hr' }));
    p.appendChild(settingRow('Snap to grid', 'Road ends jump to a 20 m grid', toggle(s.gridSnap, (v) => set('gridSnap', v)).root));
    p.appendChild(settingRow('Snap angles', 'Straight, 45° and diagonal strokes stay tidy', toggle(s.angleSnap, (v) => set('angleSnap', v)).root));
    p.appendChild(settingRow('Day / night cycle', 'Endless and sandbox worlds drift into night', toggle(s.dayNight, (v) => set('dayNight', v)).root));
    p.appendChild(
      settingRow(
        'Colour-blind marks', 'Districts also show R / C / I letters',
        toggle(s.colorBlind, (v) => set('colorBlind', v)).root,
      ),
    );
    p.appendChild(settingRow('Reduce motion', 'Fewer pulses and particles', toggle(s.reduceMotion, (v) => set('reduceMotion', v)).root));
    p.appendChild(settingRow('Show FPS', 'Frame rate counter for tuning', toggle(s.showFps, (v) => set('showFps', v)).root));

    const quality = seg(
      [
        { id: 'auto' as const, label: 'Auto' },
        { id: 'high' as const, label: 'High' },
        { id: 'low' as const, label: 'Battery' },
      ],
      s.quality,
      (v) => set('quality', v),
    );
    p.appendChild(settingRow('Graphics quality', 'Auto adapts if the frame rate drops', quality.root));

    p.appendChild(el('hr', { class: 'hr' }));
    const danger = el('div', { class: 'row', style: { gap: '9px' } }, [
      btn('Reset all progress', {
        variant: 'danger',
        icon: 'trash',
        onClick: () => {
          if (confirm('Erase stars, records, stats and every sandbox city? This cannot be undone.')) {
            this.actions.onResetProgress();
            this.render();
          }
        },
      }),
    ]);
    p.appendChild(danger);
    return p;
  }

  // ------------------------------------------------------------------- help

  private help(): HTMLElement {
    const p = panel();
    p.classList.add('help');
    p.appendChild(this.head('How to play', 'Sixty seconds to a working city', 'back'));

    const legend = el('div', { class: 'legend' }, [
      legendItem(DISTRICT_COLORS[0], `${ZONE_NAMES.R} (R)`),
      legendItem(DISTRICT_COLORS[1], `${ZONE_NAMES.C} (C)`),
      legendItem(DISTRICT_COLORS[2], `${ZONE_NAMES.I} (I)`),
    ]);
    p.appendChild(legend);
    p.appendChild(
      el('p', {
        text: 'Commuters are coloured by where they are going. A green car is heading to a green district; drop it there and you earn its fare.',
      }),
    );

    const sections: [string, string, string][] = [
      ['street', 'Draw roads', 'Drag with one finger (or the mouse) to pave. Roads snap to junctions, crossings and the grid, so networks knit together on their own.'],
      ['highway', 'Freeways fly over', 'Freeways are grade separated: they cross streets without connecting. To get traffic on or off, end the freeway at a street — that becomes a ramp.'],
      ['bridge', 'Water costs more', 'Bridges are roughly twice the price of land. Cross a river once, on the best line, rather than four times.'],
      ['coin', 'Fares fund growth', 'Every delivered commuter pays a fare based on trip length. Your starting budget only covers part of the city — the rest is earned.'],
      ['bulldoze', 'Demolish and undo', 'The bulldozer refunds a third of what a road cost. Undo (Z) rewinds whole strokes, so experiment freely.'],
      ['warn', 'The jam meter', 'When the city crawls, the red bar fills. If it tops out, the level ends. Widen the busiest link, or give traffic a second route around it.'],
      ['star', 'Stars', '★ finish the goal · ★★ finish without a serious jam · ★★★ also beat the average-commute par.'],
    ];
    for (const [ic, h, body] of sections) {
      p.appendChild(el('h3', {}, [icon(ic), el('span', { text: h })]));
      p.appendChild(el('p', { text: body }));
    }

    p.appendChild(el('h3', {}, [icon('hand'), el('span', { text: 'Controls' })]));
    const keys = el('div', { class: 'tiny dim', style: { lineHeight: '2' } });
    keys.append(
      el('div', {}, [el('span', { text: 'Touch: ' }), el('b', { text: '1 finger' }), el('span', { text: ' = build · ' }), el('b', { text: '2 fingers' }), el('span', { text: ' = pan & pinch' })]),
      el('div', {}, [el('span', { text: 'Mouse: ' }), el('b', { text: 'drag' }), el('span', { text: ' = build · ' }), el('b', { text: 'right-drag / space-drag / wheel' }), el('span', { text: ' = pan & zoom' })]),
      el('div', {}, [el('span', { text: 'Keys: ' }), ...['1', '2', '3'].map((k) => kbd(k)), el('span', { text: ' roads · ' }), kbd('X'), el('span', { text: ' bulldoze · ' }), kbd('Z'), kbd('Y'), el('span', { text: ' undo/redo · ' }), kbd('H'), el('span', { text: ' hint · ' }), kbd('F'), el('span', { text: ' fit · ' }), kbd('Space'), el('span', { text: ' pause' })]),
    );
    p.appendChild(keys);
    return p;
  }

  // ------------------------------------------------------------------ stats

  private statsScreen(): HTMLElement {
    const p = panel();
    const s = this.ctx.stats;
    const pr = this.ctx.progress;
    p.appendChild(this.head('Your record', 'Every commute counts', 'back'));
    const totalStars = LEVELS.reduce((a, l) => a + (pr.campaign[l.id]?.stars ?? 0), 0);
    p.appendChild(
      el('div', { class: 'statgrid' }, [
        statBox(formatNumber(s.delivered), 'commuters delivered'),
        statBox(formatNumber(s.levelsCompleted), 'levels completed'),
        statBox(`${totalStars}/${LEVELS.length * 3}`, 'stars'),
        statBox(formatNumber(s.endlessBest), 'best endless'),
        statBox(`${formatNumber(s.roadLength / 1000)} km`, 'road built'),
        statBox(formatNumber(s.roadsBuilt), 'roads paved'),
        statBox(formatMoney(s.moneySpent), 'spent'),
        statBox(formatMoney(s.moneyEarned), 'fares earned'),
        statBox(formatTime(s.playTime), 'time played'),
        statBox(formatNumber(s.jams), 'gridlocks'),
        statBox(formatNumber(s.dailyStreak), 'daily streak'),
        statBox(formatNumber(s.levelsFailed), 'levels failed'),
      ]),
    );

    const milestones: [string, boolean][] = [
      ['First road paved', s.roadsBuilt > 0],
      ['100 commuters delivered', s.delivered >= 100],
      ['1,000 commuters delivered', s.delivered >= 1000],
      ['10 km of road', s.roadLength >= 10000],
      ['A perfect ★★★ level', LEVELS.some((l) => (pr.campaign[l.id]?.stars ?? 0) === 3)],
      ['Chapter 1 cleared', levelsForChapter(0).every((l) => (pr.campaign[l.id]?.stars ?? 0) > 0)],
      ['Freeways unlocked', levelsForChapter(2).some((l) => (pr.campaign[l.id]?.stars ?? 0) > 0)],
      ['Survived a daily', s.dailyStreak > 0],
      ['Endless 1,000', s.endlessBest >= 1000],
      ['The whole campaign', LEVELS.every((l) => (pr.campaign[l.id]?.stars ?? 0) > 0)],
    ];
    p.appendChild(el('h3', { class: 'title', style: { fontSize: '15px', marginTop: '14px' }, text: 'Milestones' }));
    const list = el('div', { class: 'stack', style: { gap: '6px', marginTop: '8px' } });
    for (const [name, got] of milestones) {
      list.appendChild(
        el('div', { class: 'row', style: { gap: '9px', opacity: got ? '1' : '0.4' } }, [
          icon(got ? 'check' : 'lock'),
          el('span', { class: 'tiny', text: name, style: { fontWeight: '700' } }),
        ]),
      );
    }
    p.appendChild(list);
    return p;
  }

  // ---------------------------------------------------------------- endless

  private endless(): HTMLElement {
    const p = panel();
    p.style.maxWidth = '440px';
    p.style.margin = '0 auto';
    p.appendChild(this.head('Endless', 'A generated city that never stops growing', 'back'));

    const seed = randomSeedText();
    const seedInput = el('input', { class: 'field', type: 'text' }) as HTMLInputElement;
    seedInput.value = seed;
    seedInput.maxLength = 12;
    seedInput.autocapitalize = 'characters';
    seedInput.spellcheck = false;

    let difficulty = 4;
    const diffSeg = seg(
      [
        { id: '1', label: 'Calm' },
        { id: '4', label: 'Busy' },
        { id: '8', label: 'Brutal' },
        { id: '13', label: 'Insane' },
      ],
      '4',
      (v) => {
        difficulty = parseInt(v, 10);
      },
    );

    p.appendChild(el('div', { class: 'eyebrow', text: 'SEED' }));
    p.appendChild(
      el('div', { class: 'row', style: { gap: '8px', marginTop: '6px' } }, [
        seedInput,
        iconBtn('refresh', { title: 'New seed', onClick: () => (seedInput.value = randomSeedText()) }),
      ]),
    );
    p.appendChild(el('div', { class: 'eyebrow', style: { marginTop: '14px' }, text: 'STARTING DIFFICULTY' }));
    p.appendChild(el('div', { style: { marginTop: '6px' } }, [diffSeg.root]));
    p.appendChild(
      el('div', { class: 'subtitle', style: { marginTop: '12px' }, text: `Best score: ${formatNumber(this.ctx.endlessBest)}. Demand grows forever — the run ends when the city gridlocks.` }),
    );
    p.appendChild(
      el('div', { class: 'row', style: { gap: '9px', marginTop: '14px' } }, [
        btn('Menu', { variant: 'ghost', onClick: () => this.actions.onBack() }),
        btn('Start run', {
          variant: 'primary',
          big: true,
          icon: 'play',
          onClick: () => this.actions.onEndless((seedInput.value || seed).toUpperCase().slice(0, 12), difficulty),
        }),
      ]),
    );
    return p;
  }

  // --------------------------------------------------------------- sandbox

  private sandbox(): HTMLElement {
    const p = panel();
    p.style.maxWidth = '480px';
    p.style.margin = '0 auto';
    p.appendChild(this.head('Sandbox', 'Unlimited funds, every tool, saved cities', 'back'));

    const seedInput = el('input', { class: 'field', type: 'text' }) as HTMLInputElement;
    seedInput.value = randomSeedText();
    seedInput.maxLength = 12;
    let size = 1200;
    const sizeSeg = seg(
      [
        { id: '900', label: 'Small' },
        { id: '1200', label: 'Large' },
        { id: '1500', label: 'Huge' },
      ],
      '1200',
      (v) => (size = parseInt(v, 10)),
    );
    p.appendChild(el('div', { class: 'eyebrow', text: 'NEW WORLD' }));
    p.appendChild(
      el('div', { class: 'row', style: { gap: '8px', marginTop: '6px' } }, [
        seedInput,
        iconBtn('refresh', { title: 'New seed', onClick: () => (seedInput.value = randomSeedText()) }),
      ]),
    );
    p.appendChild(el('div', { style: { marginTop: '8px' } }, [sizeSeg.root]));
    p.appendChild(
      el('div', { class: 'row', style: { gap: '9px', marginTop: '12px' } }, [
        btn('Build it', {
          variant: 'primary',
          icon: 'seed',
          onClick: () => this.actions.onSandboxNew((seedInput.value || 'TRAFFER').toUpperCase().slice(0, 12), size),
        }),
      ]),
    );

    p.appendChild(el('hr', { class: 'hr' }));
    p.appendChild(el('div', { class: 'eyebrow', text: `SAVED CITIES (${this.ctx.sandbox.length})` }));
    const list = el('div', { class: 'savelist', style: { marginTop: '8px' } });
    if (!this.ctx.sandbox.length) {
      list.appendChild(el('div', { class: 'tiny dim', text: 'Nothing saved yet. Use the save button while building a sandbox world.' }));
    }
    for (const s of this.ctx.sandbox) {
      const item = el('div', { class: 'saveitem' }, [
        el('div', { class: 'grow' }, [
          el('div', { class: 'nm', text: s.name }),
          el('div', {
            class: 'mt',
            text: `${s.seed} · ${s.roads} roads · ${s.zones} districts · ${formatNumber(s.delivered)} delivered · ${new Date(
              s.savedAt,
            ).toLocaleDateString()}`,
          }),
        ]),
        iconBtn('play', { title: 'Load', onClick: () => this.actions.onSandboxLoad(s.id) }),
        iconBtn('trash', {
          title: 'Delete',
          onClick: () => {
            if (confirm(`Delete "${s.name}"?`)) this.actions.onSandboxDelete(s.id);
          },
        }),
      ]);
      list.appendChild(item);
    }
    p.appendChild(list);
    p.appendChild(
      el('div', { class: 'row', style: { gap: '9px', marginTop: '14px' } }, [
        btn('Menu', { variant: 'ghost', onClick: () => this.actions.onBack() }),
      ]),
    );
    return p;
  }
}

// ------------------------------------------------------------------- helpers

function menuCard(ic: string, title: string, desc: string, variant: string, onClick: () => void): HTMLElement {
  const b = btn('', { variant: variant as 'primary', onClick });
  b.classList.add('menubtn');
  b.append(icon(ic), el('span', { class: 't', text: title }), el('span', { class: 'd', text: desc }));
  return b;
}

function chipText(ic: string, value: string, suffix: string): HTMLElement {
  const c = el('div', { class: 'chip' }, [icon(ic), el('b', { text: value })]);
  if (suffix) c.appendChild(el('span', { text: suffix }));
  return c;
}

function legendItem(color: string, label: string): HTMLElement {
  return el('div', { class: 'it' }, [el('span', { class: 'swatch', style: { background: color } }), el('span', { text: label })]);
}

function settingRow(title: string, desc: string, control: HTMLElement): HTMLElement {
  return el('div', { class: 'setrow' }, [
    el('div', { class: 'lbl' }, [el('div', { class: 't', text: title }), el('div', { class: 'd', text: desc })]),
    control,
  ]);
}

function kbd(k: string): HTMLElement {
  return el('kbd', { text: k });
}

function randomSeedText(): string {
  const chars = 'ACDEFGHJKLMNPQRTUVWXY3479';
  let s = '';
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}

export { randomSeedText };
