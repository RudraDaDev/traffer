/**
 * Entry point. Boots the game into #app and removes the splash screen once the
 * first frame is on screen.
 */
import { bootFailed, bootProgress } from './core/boot';
import { Game } from './game/game';
import './styles.css';

function boot(): void {
  bootProgress(8, 'Loading engine');
  const app = document.getElementById('app');
  if (!app) {
    bootFailed('Page failed to start.');
    return;
  }
  let game: Game;
  try {
    bootProgress(18, 'Building the stage');
    game = new Game(app);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'The game failed to start.';
    bootFailed(message);
    return;
  }
  (window as unknown as { traffer: Game }).traffer = game;

  const splash = document.getElementById('splash');
  const hide = () => {
    if (!splash || splash.classList.contains('fail')) return;
    bootProgress(100, 'Ready');
    (window as unknown as { __trafferBooted?: boolean }).__trafferBooted = true;
    splash.classList.add('gone');
    window.setTimeout(() => splash.remove(), 600);
  };
  // let the first world finish painting before revealing
  requestAnimationFrame(() => requestAnimationFrame(() => window.setTimeout(hide, 160)));

  const unlock = () => {
    game.audio.unlock();
    window.removeEventListener('pointerdown', unlock);
    window.removeEventListener('keydown', unlock);
  };
  window.addEventListener('pointerdown', unlock, { once: false });
  window.addEventListener('keydown', unlock, { once: false });
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
else boot();
