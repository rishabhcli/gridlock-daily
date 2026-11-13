// Local preview: serves dist/client and stubs the Devvit API in memory (no Reddit needed).
//   node tools/preview.mjs [--port=5173] [--day=YYYY-MM-DD] [--anon] [--no-seed]
// Open http://localhost:5173/splash.html (feed card) or /game.html (expanded game).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nextStreak, puzzleForDay, replay, shareText, utcDay, visibleStreak, difficultyLabel, weekday, DAY_NAMES } from '../src/shared/puzzle.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dir = path.join(root, 'dist', 'client');
const arg = (n) => process.argv.find((a) => a.startsWith(`--${n}=`))?.split('=')[1];
const port = Number(arg('port') ?? 5173);
const day = arg('day') ?? utcDay();
const anon = process.argv.includes('--anon');
const me = 'preview_user';

const puzzle = puzzleForDay(day);
const dto = { day, number: puzzle.number, cars: puzzle.cars, par: puzzle.par, difficulty: difficultyLabel(day), weekday: DAY_NAMES[weekday(day)] };
const results = new Map(); // username -> {moves, ms, hints}
let streak = { current: 0, best: 0, last: null };

if (!process.argv.includes('--no-seed')) {
  // Demo-only players so the leaderboard and histogram have something to show in the local preview.
  results.set('demo_ada', { moves: puzzle.par, ms: 41200, hints: false });
  results.set('demo_linus', { moves: puzzle.par + 2, ms: 63500, hints: false });
  results.set('demo_grace', { moves: puzzle.par + 1, ms: 52800, hints: false });
  results.set('demo_ken', { moves: puzzle.par + 5, ms: 98000, hints: true });
}

const histogram = () => {
  const h = {};
  for (const r of results.values()) h[r.moves] = (h[r.moves] ?? 0) + 1;
  return h;
};
const score = (r) => r.moves * 1e8 + Math.min(r.ms, 99999999);
const ranked = () =>
  [...results.entries()]
    .filter(([, r]) => !r.hints)
    .sort((a, b) => score(a[1]) - score(b[1]))
    .map(([username, r], i) => ({ rank: i + 1, username, moves: r.moves, ms: r.ms }));
const sv = () => ({ current: visibleStreak(streak, utcDay()), best: streak.best });

const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.svg': 'image/svg+xml' };

function json(res, code, body) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/api/today') {
    return json(res, 200, {
      type: 'today',
      puzzle: dto,
      isToday: day === utcDay(),
      loggedIn: !anon,
      username: anon ? null : me,
      result: anon ? null : (results.get(me) ?? null),
      streak: anon ? { current: 0, best: 0 } : sv(),
      solveCount: results.size,
      histogram: histogram(),
      postId: 't3_preview',
    });
  }
  if (url.pathname === '/api/leaderboard') {
    const entries = ranked();
    return json(res, 200, { type: 'leaderboard', day, entries: entries.slice(0, 10), me: entries.find((e) => e.username === me) ?? null, total: entries.length });
  }
  if (url.pathname === '/api/submit' && req.method === 'POST') {
    let raw = '';
    for await (const c of req) raw += c;
    let body;
    try {
      body = JSON.parse(raw);
    } catch {
      return json(res, 400, { status: 'error', message: 'Bad request' });
    }
    const check = replay(puzzle.cars, body.moves);
    if (!check.ok) return json(res, 422, { status: 'error', message: `That move list is not a valid solution (${check.reason}).` });
    const result = { moves: check.moves, ms: Math.max(0, Math.round(Number(body.ms) || 0)), hints: !!body.hints };
    if (anon) {
      return json(res, 200, { type: 'submit', saved: false, improved: false, result, rank: null, streak: { current: 0, best: 0 }, solveCount: results.size, histogram: histogram(), par: puzzle.par });
    }
    const prev = results.get(me);
    const better = !prev || (prev.hints !== result.hints ? !result.hints : score(result) < score(prev));
    if (better) results.set(me, result);
    streak = nextStreak(streak, day, utcDay());
    const mine = results.get(me);
    const rank = mine.hints ? null : (ranked().find((e) => e.username === me)?.rank ?? null);
    return json(res, 200, { type: 'submit', saved: true, improved: !!better, result: mine, rank, streak: sv(), solveCount: results.size, histogram: histogram(), par: puzzle.par });
  }
  if (url.pathname === '/api/share-comment' && req.method === 'POST') {
    const mine = results.get(me);
    if (!mine) return json(res, 400, { status: 'error', message: 'Solve the puzzle first.' });
    console.log('[preview] would post comment:\n' + shareText({ number: puzzle.number, moves: mine.moves, par: puzzle.par, streak: sv().current, hints: mine.hints }));
    return json(res, 200, { type: 'share-comment', ok: true, message: 'Comment posted (preview stub)' });
  }
  // static
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/splash.html';
  const file = path.join(dir, path.normalize(p).replace(/^(\.\.[/\\])+/, ''));
  if (!file.startsWith(dir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end('not found');
  }
  res.writeHead(200, { 'content-type': mime[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});

server.listen(port, '127.0.0.1', () => {
  console.log(`Gridlock Daily preview: http://localhost:${port}/game.html  (splash: /splash.html)`);
  console.log(`puzzle ${day} #${puzzle.number} par ${puzzle.par}, ${puzzle.cars.length} cars, ${anon ? 'logged out' : 'logged in as ' + me}`);
});
