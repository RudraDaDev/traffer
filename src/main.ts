/**
 * Entry point. Boots the game into #app and removes the splash screen once the
 * first frame is on screen.
 */
import { Game } from './game/game';
import './styles.css';

function boot(): void {
  const app = document.getElementById('app');
  if (!app) return;
  const game = new Game(app);
  (window as unknown as { traffer: Game }).traffer = game;

  const splash = document.getElementById('splash');
  const hide = () => {
    if (!splash) return;
    splash.classList.add('gone');
    window.setTimeout(() => splash.remove(), 600);
  };
  // let the first world finish generating before revealing
  requestAnimationFrame(() => requestAnimationFrame(() => window.setTimeout(hide, 120)));

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
