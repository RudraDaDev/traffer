/**
 * In-game HUD. Built once, then updated by diffing against the previous state
 * so a 60 fps sync never touches layout unnecessarily.
 */

import { el } from '../core/dom';
import { formatMoney, formatNumber, formatTime } from '../core/math';
import type { GameMode, ToolId } from '../game/config';
import { bar, chip, icon, iconBtn, stars as starsWidget } from './widgets';

export interface ToolInfo {
  id: ToolId;
  name: string;
  cost: string;
  icon: string;
  enabled: boolean;
  key: string;
}

export interface HudState {
  levelName: string;
  chapterName: string;
  mode: GameMode;
  money: number;
  income: number;
  delivered: number;
  goal: number;
  time: number;
  cars: number;
  jam: number;
  jamEnabled: boolean;
  tool: ToolId;
  tools: ToolInfo[];
  speed: number;
  canUndo: boolean;
  canRedo: boolean;
  showSave: boolean;
  hintText: string | null;
  stars: number;
  gridlock: boolean;
  paused: boolean;
}

export interface HudActions {
  onPause(): void;
  onTool(t: ToolId): void;
  onSpeed(): void;
  onUndo(): void;
  onRedo(): void;
  onHint(): void;
  onZoom(d: number): void;
  onFit(): void;
  onSave(): void;
}

export class HUD {
  root: HTMLElement;
  private topbar: HTMLElement;
  private nameNode: HTMLElement;
  private subNode: HTMLElement;
  private timeNode: HTMLElement;
  private speedBtn: HTMLElement;
  private goalBar: ReturnType<typeof bar>;
  private goalLabel: HTMLElement;
  private moneyNode: HTMLElement;
  private incomeNode: HTMLElement;
  private carsNode: HTMLElement;
  private jamBar: ReturnType<typeof bar>;
  private jamStrip: HTMLElement;
  private toolsRow: HTMLElement;
  private toolBtns = new Map<ToolId, HTMLElement>();
  private undoBtn: HTMLButtonElement;
  private redoBtn: HTMLButtonElement;
  private hintBtn: HTMLButtonElement;
  private saveBtn: HTMLButtonElement;
  private banner: HTMLElement;
  private pauseBtn: HTMLButtonElement;
  private coach: HTMLElement | null = null;
  private coachWrap: HTMLElement;
  private prev: Partial<HudState> = {};
  private prevTools = '';
  actions: HudActions;

  constructor(actions: HudActions) {
    this.actions = actions;
    this.root = el('div', { id: 'hud' });

    // ---- top bar
    this.pauseBtn = iconBtn('pause', { title: 'Menu (Esc)', onClick: () => actions.onPause() });
    this.nameNode = el('div', { class: 'n', text: 'Level' });
    this.subNode = el('div', { class: 's', text: '' });
    this.timeNode = el('b', { text: '0:00' });
    this.topbar = el('div', { class: 'topbar' }, [
      this.pauseBtn,
      el('div', { class: 'lvl' }, [this.nameNode, this.subNode]),
      chip('clock', this.timeNode),
    ]);

    this.speedBtn = iconBtn('fast', { title: 'Simulation speed', cls: 'speedbtn', onClick: () => actions.onSpeed() });
    this.speedBtn.appendChild(el('span', { text: '1×', style: { fontSize: '11px', fontWeight: '800' } }));
    this.topbar.appendChild(this.speedBtn);

    // ---- stat strip
    this.goalLabel = el('span', { text: '0 / 0' });
    const goalLbl = el('div', { class: 'lbl' }, [el('span', { text: 'COMMUTERS' }), this.goalLabel]);
    this.goalBar = bar('thin');
    this.moneyNode = el('b', { text: '$0' });
    this.incomeNode = el('b', { text: '+0/s' });
    this.carsNode = el('b', { text: '0' });
    const statbar = el('div', { class: 'statbar' }, [
      el('div', { class: 'goalwrap' }, [goalLbl, this.goalBar.root]),
      chip('coin', this.moneyNode),
      chip('bolt', this.incomeNode),
      chip('car', this.carsNode),
    ]);

    // ---- jam strip
    this.jamBar = bar('jam thin');
    this.jamStrip = el('div', { class: 'jamstrip' }, [this.jamBar.root]);

    // ---- banner
    this.banner = el('div', { class: 'banner hidden', text: 'Gridlock' });

    // ---- dock
    this.toolsRow = el('div', { class: 'tools' });
    this.undoBtn = iconBtn('undo', { title: 'Undo (Z)', onClick: () => actions.onUndo() });
    this.redoBtn = iconBtn('redo', { title: 'Redo (Y)', onClick: () => actions.onRedo() });
    this.hintBtn = iconBtn('bulb', { title: 'Hint (H)', onClick: () => actions.onHint() });
    this.saveBtn = iconBtn('save', { title: 'Save this city (Ctrl+S)', onClick: () => actions.onSave() });
    this.saveBtn.classList.add('hidden');
    const utils = el('div', { class: 'utils' }, [
      this.undoBtn,
      this.redoBtn,
      this.hintBtn,
      this.saveBtn,
      iconBtn('zoomOut', { title: 'Zoom out (−)', onClick: () => actions.onZoom(-1) }),
      iconBtn('zoomIn', { title: 'Zoom in (+)', onClick: () => actions.onZoom(1) }),
      iconBtn('fit', { title: 'Fit map (F)', onClick: () => actions.onFit() }),
    ]);
    const dock = el('div', { class: 'dock' }, [this.toolsRow, utils]);

    // ---- coach card slot
    this.coachWrap = el('div');

    this.root.append(this.topbar, statbar, this.jamStrip, this.banner, dock, this.coachWrap);
  }

  show(on: boolean): void {
    this.root.classList.toggle('on', on);
  }

  private buildTools(tools: ToolInfo[]): void {
    this.toolsRow.textContent = '';
    this.toolBtns.clear();
    for (const t of tools) {
      if (!t.enabled) continue;
      const b = el('button', { class: 'tool', type: 'button', title: `${t.name}${t.cost ? ' · ' + t.cost : ''}` });
      b.appendChild(icon(t.icon));
      b.appendChild(el('span', { class: 'nm', text: t.name }));
      if (t.cost) b.appendChild(el('span', { class: 'cost', text: t.cost }));
      if (t.key) b.appendChild(el('span', { class: 'key', text: t.key }));
      b.addEventListener('click', () => this.actions.onTool(t.id));
      this.toolsRow.appendChild(b);
      this.toolBtns.set(t.id, b);
    }
  }

  /** Tutorial / coaching card. Pass null to dismiss. */
  setCoach(head: string | null, body?: string, onClose?: () => void): void {
    if (!head) {
      if (this.coach) {
        this.coach.remove();
        this.coach = null;
      }
      return;
    }
    if (!this.coach) {
      this.coach = el('div', { class: 'coach' });
      this.coachWrap.appendChild(this.coach);
    }
    this.coach.textContent = '';
    this.coach.append(
      el('div', { class: 'h', text: head }),
      el('div', { class: 'b', text: body ?? '' }),
    );
    if (onClose) {
      const x = iconBtn('close', { title: 'Dismiss', cls: 'x', onClick: onClose });
      x.style.width = '28px';
      x.style.height = '28px';
      this.coach.appendChild(x);
    }
  }

  setBanner(text: string | null): void {
    if (text) {
      this.banner.textContent = text;
      this.banner.classList.remove('hidden');
    } else {
      this.banner.classList.add('hidden');
    }
  }

  sync(s: HudState): void {
    const p = this.prev;

    const toolKey = s.tools.map((t) => `${t.id}${t.enabled ? 1 : 0}${t.cost}`).join('|');
    if (toolKey !== this.prevTools) {
      this.prevTools = toolKey;
      this.buildTools(s.tools);
    }
    if (p.tool !== s.tool) {
      for (const [id, b] of this.toolBtns) b.classList.toggle('on', id === s.tool);
    }
    if (p.levelName !== s.levelName || p.chapterName !== s.chapterName) {
      this.nameNode.textContent = s.levelName;
      this.subNode.textContent = s.chapterName;
    }
    const tt = formatTime(s.time);
    if (p.time === undefined || formatTime(p.time) !== tt) this.timeNode.textContent = tt;

    if (p.delivered !== s.delivered || p.goal !== s.goal) {
      this.goalLabel.textContent = s.goal > 0 ? `${formatNumber(s.delivered)} / ${formatNumber(s.goal)}` : `${formatNumber(s.delivered)}`;
      this.goalBar.set(s.goal > 0 ? s.delivered / s.goal : 0);
    }
    const money = Math.floor(s.money);
    if (p.money === undefined || Math.floor(p.money) !== money) {
      this.moneyNode.textContent = s.mode === 'sandbox' && money > 1e8 ? '∞' : formatMoney(money);
    }
    const inc = Math.round(s.income);
    if (p.income !== s.income || Math.round(p.income ?? -1) !== inc) this.incomeNode.textContent = `+${inc}/s`;
    if (p.cars !== s.cars) this.carsNode.textContent = String(s.cars);

    const jamPct = Math.round(s.jam * 40);
    if (Math.round((p.jam ?? -1) * 40) !== jamPct) this.jamBar.set(s.jam);
    this.jamStrip.style.display = s.jamEnabled ? '' : 'none';

    if (p.showSave !== s.showSave) this.saveBtn.classList.toggle('hidden', !s.showSave);
    if (p.canUndo !== s.canUndo) this.undoBtn.disabled = !s.canUndo;
    if (p.canRedo !== s.canRedo) this.redoBtn.disabled = !s.canRedo;
    if (p.hintText !== s.hintText) {
      this.hintBtn.disabled = !s.hintText;
      this.hintBtn.title = s.hintText ? `Hint: ${s.hintText}` : 'No hint right now';
    }
    if (p.gridlock !== s.gridlock) this.setBanner(s.gridlock ? '⚠ Gridlock — traffic is dying' : null);
    if (p.speed !== s.speed || p.paused !== s.paused) {
      const label = this.speedBtn.querySelector('span');
      if (label) label.textContent = s.paused ? '❚❚' : `${s.speed}×`;
      this.speedBtn.classList.toggle('on', s.speed > 1);
      this.pauseBtn.firstChild?.replaceWith(icon(s.paused ? 'play' : 'pause'));
    }
    this.prev = { ...s };
  }

  /** Big star row used by the results screen. */
  static starRow(n: number): HTMLElement {
    return starsWidget(n, 3, true);
  }
}
