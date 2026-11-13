// Inline splash: vanilla DOM, no framework, so it paints fast in the feed.
import './index.css';
import { getToday } from './api';
import { expand } from './host';
import { carColor } from '../shared/puzzle';
import type { TodayResponse } from '../shared/api';

const root = document.getElementById('root')!;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function preview(t: TodayResponse): HTMLElement {
  const pv = el('div', 'pv');
  pv.setAttribute('role', 'img');
  pv.setAttribute('aria-label', `Preview of today's ${t.puzzle.cars.length}-car puzzle`);
  const board = el('div', 'board');
  for (const c of t.puzzle.cars) {
    const d = el('div', `car ${c.horiz ? 'h' : 'v'}${c.id === 0 ? ' red' : ''}`);
    d.style.left = `${(c.x / 6) * 100}%`;
    d.style.top = `${(c.y / 6) * 100}%`;
    d.style.width = `${((c.horiz ? c.len : 1) / 6) * 100}%`;
    d.style.height = `${((c.horiz ? 1 : c.len) / 6) * 100}%`;
    d.style.setProperty('--c', carColor(c.id));
    const body = el('div', 'body');
    body.append(el('div', 'glass'), el('div', 'lights'));
    d.append(body);
    board.append(d);
  }
  const exit = el('div', 'exit');
  exit.append(el('span', undefined, '›'));
  pv.append(board, exit);
  return pv;
}

function render(t: TodayResponse) {
  root.textContent = '';
  const wrap = el('div', 'splash');
  const info = el('div', 'info');
  info.append(el('h1', undefined, `Gridlock Daily #${t.puzzle.number}`));
  info.append(el('div', 'meta', `${t.puzzle.weekday} puzzle · ${t.puzzle.difficulty} · par ${t.puzzle.par}`));
  const chips = el('div', 'chips');
  if (t.result) chips.append(el('span', 'badge good', `Solved in ${t.result.moves}`));
  if (t.streak.current > 0) chips.append(el('span', 'badge', `🔥 ${t.streak.current}-day streak`));
  chips.append(el('span', 'badge', `${t.solveCount} solved today`));
  info.append(chips);
  const btn = el('button', 'btn primary big', t.result ? 'Play again' : 'Play');
  btn.type = 'button';
  btn.addEventListener('click', (e) => expand(e));
  info.append(btn);
  if (!t.loggedIn) info.append(el('div', 'meta', 'Log in to save your streak.'));
  wrap.append(preview(t), info);
  root.append(wrap);
}

function renderError() {
  root.textContent = '';
  const wrap = el('div', 'splash');
  const info = el('div', 'info');
  info.append(el('h1', undefined, 'Gridlock Daily'));
  info.append(el('div', 'meta', 'Slide the cars. Free the red one.'));
  const btn = el('button', 'btn primary big', 'Play');
  btn.type = 'button';
  btn.addEventListener('click', (e) => expand(e));
  info.append(btn);
  wrap.append(info);
  root.append(wrap);
}

// Immediate paint so the post never looks empty while the API call runs.
renderError();
getToday().then(render).catch(() => undefined);
