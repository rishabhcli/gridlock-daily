// Pure puzzle logic shared by client and server. No DOM / Node APIs.

export const SIZE = 6;
export const RED_ROW = 2;
export const EPOCH_DAY = '2026-11-16'; // Puzzle #1

export type Car = {
  id: number; // 0 is always the red car
  x: number; // column of the top-left cell
  y: number; // row of the top-left cell
  len: number; // 2 or 3
  horiz: boolean;
};

export type Puzzle = {
  day: string; // YYYY-MM-DD (UTC)
  number: number;
  cars: Car[];
  par: number;
};

export type Move = { carId: number; delta: number };

// ---------- dates ----------

export function utcDay(d: Date = new Date()): string {
  return d.toISOString().slice(0, 10);
}

export function isDayString(s: unknown): s is string {
  return typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
}

export function dayToIndex(day: string): number {
  return Math.floor(Date.parse(day + 'T00:00:00Z') / 86400000);
}

export function addDays(day: string, n: number): string {
  return new Date((dayToIndex(day) + n) * 86400000).toISOString().slice(0, 10);
}

export function puzzleNumber(day: string): number {
  return Math.max(1, dayToIndex(day) - dayToIndex(EPOCH_DAY) + 1); // days before launch show as #1
}

export function weekday(day: string): number {
  return new Date(day + 'T00:00:00Z').getUTCDay(); // 0 = Sunday
}

export const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** [min, max] par per weekday (index 0 = Sunday). */
export const BANDS: [number, number][] = [
  [18, 26], // Sun
  [6, 9], // Mon
  [8, 11], // Tue
  [10, 13], // Wed
  [12, 15], // Thu
  [14, 18], // Fri
  [16, 22], // Sat
];

export function bandFor(day: string): [number, number] {
  return BANDS[weekday(day)]!;
}

export function difficultyLabel(day: string): string {
  return ['Brutal', 'Easy', 'Gentle', 'Medium', 'Tricky', 'Hard', 'Tough'][weekday(day)]!;
}

// ---------- PRNG ----------

export function fnv1a(str: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- board helpers ----------

export function cellsOf(c: Car, pos?: number): [number, number][] {
  const out: [number, number][] = [];
  for (let i = 0; i < c.len; i++) {
    out.push(c.horiz ? [(pos ?? c.x) + i, c.y] : [c.x, (pos ?? c.y) + i]);
  }
  return out;
}

/** Position of a car along its axis. */
export function axisPos(c: Car): number {
  return c.horiz ? c.x : c.y;
}

function occupancy(cars: Car[], pos: number[]): Int8Array {
  const occ = new Int8Array(SIZE * SIZE).fill(-1);
  for (let i = 0; i < cars.length; i++) {
    const c = cars[i]!;
    for (let k = 0; k < c.len; k++) {
      const x = c.horiz ? pos[i]! + k : c.x;
      const y = c.horiz ? c.y : pos[i]! + k;
      occ[y * SIZE + x] = i;
    }
  }
  return occ;
}

export function validBoard(cars: Car[]): boolean {
  const seen = new Set<number>();
  for (const c of cars) {
    if (c.len < 2 || c.len > 3) return false;
    for (const [x, y] of cellsOf(c)) {
      if (x < 0 || y < 0 || x >= SIZE || y >= SIZE) return false;
      const k = y * SIZE + x;
      if (seen.has(k)) return false;
      seen.add(k);
    }
  }
  const r = cars[0];
  return !!r && r.id === 0 && r.horiz && r.y === RED_ROW && r.len === 2;
}

export function isSolved(cars: Car[], pos: number[]): boolean {
  return pos[0]! + cars[0]!.len >= SIZE;
}

function encode(pos: number[]): number {
  let k = 0;
  for (let i = 0; i < pos.length; i++) k = k * 8 + pos[i]!;
  return k;
}

/** Car positions with a car id -> index mapping (cars are ordered by id). */
export function positionsOf(cars: Car[]): number[] {
  return cars.map(axisPos);
}

export type SolveResult = { moves: Move[]; par: number } | null;

/**
 * BFS over board states. Sliding one car any number of cells is ONE move.
 * Solved when the red car touches the right edge (x = 4), where it can drive out.
 * Returns null when unsolvable or when maxStates is exceeded.
 */
export function solve(cars: Car[], start?: number[], maxStates = 400000): SolveResult {
  const n = cars.length;
  const s0 = start ?? positionsOf(cars);
  if (isSolved(cars, s0)) return { moves: [], par: 0 };
  const pow: number[] = [];
  for (let i = 0; i < n; i++) pow.push(8 ** (n - 1 - i));
  const redWin = SIZE - cars[0]!.len;
  const startKey = encode(s0);
  // value = prevKey * 256 + car * 16 + (delta + 8)
  const parent = new Map<number, number>();
  parent.set(startKey, -1);
  let frontier: number[] = [startKey];
  const pos = new Array<number>(n).fill(0);
  const occ = new Int8Array(SIZE * SIZE);
  while (frontier.length) {
    const next: number[] = [];
    for (const key of frontier) {
      occ.fill(-1);
      for (let i = 0; i < n; i++) {
        const p = Math.floor(key / pow[i]!) % 8;
        pos[i] = p;
        const c = cars[i]!;
        if (c.horiz) for (let k = 0; k < c.len; k++) occ[c.y * SIZE + p + k] = i;
        else for (let k = 0; k < c.len; k++) occ[(p + k) * SIZE + c.x] = i;
      }
      for (let i = 0; i < n; i++) {
        const c = cars[i]!;
        const p = pos[i]!;
        for (let dir = -1; dir <= 1; dir += 2) {
          for (let step = 1; ; step++) {
            const np = p + dir * step;
            let cell: number;
            if (dir < 0) {
              if (np < 0) break;
              cell = c.horiz ? c.y * SIZE + np : np * SIZE + c.x;
            } else {
              const edge = np + c.len - 1;
              if (edge >= SIZE) break;
              cell = c.horiz ? c.y * SIZE + edge : edge * SIZE + c.x;
            }
            if (occ[cell] !== -1) break;
            const nk = key + dir * step * pow[i]!;
            if (parent.has(nk)) continue;
            parent.set(nk, key * 256 + i * 16 + (dir * step + 8));
            if (i === 0 && np >= redWin) {
              const moves: Move[] = [];
              let k = nk;
              for (;;) {
                const v = parent.get(k)!;
                if (v < 0) break;
                const prev = Math.floor(v / 256);
                const rem = v % 256;
                moves.push({ carId: cars[Math.floor(rem / 16)]!.id, delta: (rem % 16) - 8 });
                k = prev;
              }
              moves.reverse();
              return { moves, par: moves.length };
            }
            if (parent.size > maxStates) return null;
            next.push(nk);
          }
        }
      }
    }
    frontier = next;
  }
  return null;
}

// ---------- replay / validation ----------

export type ReplayResult = { ok: true; moves: number } | { ok: false; reason: string };

export const MAX_MOVES = 400;

/** Replays a client move list on the board. Must be legal and end exactly on the winning move. */
export function replay(cars: Car[], moves: unknown): ReplayResult {
  if (!Array.isArray(moves)) return { ok: false, reason: 'moves must be a list' };
  if (moves.length === 0) return { ok: false, reason: 'no moves' };
  if (moves.length > MAX_MOVES) return { ok: false, reason: 'too many moves' };
  const pos = positionsOf(cars);
  for (let m = 0; m < moves.length; m++) {
    const mv = moves[m] as Partial<Move> | null;
    if (!mv || typeof mv !== 'object') return { ok: false, reason: `move ${m + 1} malformed` };
    const { carId, delta } = mv;
    if (!Number.isInteger(carId) || !Number.isInteger(delta) || delta === 0) {
      return { ok: false, reason: `move ${m + 1} malformed` };
    }
    const i = cars.findIndex((c) => c.id === carId);
    if (i < 0) return { ok: false, reason: `move ${m + 1} unknown car` };
    if (isSolved(cars, pos)) return { ok: false, reason: 'moves after solved' };
    const c = cars[i]!;
    const d = delta as number;
    const dir = d < 0 ? -1 : 1;
    const occ = occupancy(cars, pos);
    for (let s = 1; s <= Math.abs(d); s++) {
      const np = pos[i]! + dir * s;
      const edge = dir < 0 ? np : np + c.len - 1;
      if (edge < 0 || edge >= SIZE) return { ok: false, reason: `move ${m + 1} leaves board` };
      const cell = c.horiz ? c.y * SIZE + edge : edge * SIZE + c.x;
      if (occ[cell] !== -1) return { ok: false, reason: `move ${m + 1} blocked` };
    }
    pos[i] = pos[i]! + d;
  }
  if (!isSolved(cars, pos)) return { ok: false, reason: 'puzzle not solved' };
  return { ok: true, moves: moves.length };
}

/** Apply a legal move (no validation of result beyond bounds); returns new position array or null. */
export function tryMove(cars: Car[], pos: number[], carId: number, delta: number): number[] | null {
  const i = cars.findIndex((c) => c.id === carId);
  if (i < 0 || delta === 0) return null;
  const c = cars[i]!;
  const dir = delta < 0 ? -1 : 1;
  const occ = occupancy(cars, pos);
  for (let s = 1; s <= Math.abs(delta); s++) {
    const np = pos[i]! + dir * s;
    const edge = dir < 0 ? np : np + c.len - 1;
    if (edge < 0 || edge >= SIZE) return null;
    const cell = c.horiz ? c.y * SIZE + edge : edge * SIZE + c.x;
    if (occ[cell] !== -1) return null;
  }
  const out = pos.slice();
  out[i] = pos[i]! + delta;
  return out;
}

/** How far car i can slide in each direction from the given positions: [maxBack, maxForward] as positive counts. */
export function slideRange(cars: Car[], pos: number[], i: number): [number, number] {
  const c = cars[i]!;
  const occ = occupancy(cars, pos);
  let back = 0;
  let fwd = 0;
  for (let s = 1; ; s++) {
    const np = pos[i]! - s;
    if (np < 0) break;
    const cell = c.horiz ? c.y * SIZE + np : np * SIZE + c.x;
    if (occ[cell] !== -1) break;
    back = s;
  }
  for (let s = 1; ; s++) {
    const edge = pos[i]! + s + c.len - 1;
    if (edge >= SIZE) break;
    const cell = c.horiz ? c.y * SIZE + edge : edge * SIZE + c.x;
    if (occ[cell] !== -1) break;
    fwd = s;
  }
  return [back, fwd];
}

// ---------- generation ----------

function randInt(rnd: () => number, n: number): number {
  return Math.floor(rnd() * n);
}

function randomBoard(rnd: () => number, carCount: number): Car[] {
  const occ = new Uint8Array(SIZE * SIZE);
  const cars: Car[] = [];
  const redX = randInt(rnd, 3); // 0..2
  cars.push({ id: 0, x: redX, y: RED_ROW, len: 2, horiz: true });
  occ[RED_ROW * SIZE + redX] = 1;
  occ[RED_ROW * SIZE + redX + 1] = 1;
  let attempts = 0;
  while (cars.length < carCount && attempts < 400) {
    attempts++;
    const horiz = rnd() < 0.5;
    const len = rnd() < 0.72 ? 2 : 3;
    const x = randInt(rnd, horiz ? SIZE - len + 1 : SIZE);
    const y = randInt(rnd, horiz ? SIZE : SIZE - len + 1);
    // other horizontal cars may not sit on the red row (they would make the puzzle unsolvable)
    if (horiz && y === RED_ROW) continue;
    const car: Car = { id: cars.length, x, y, len, horiz };
    if (cellsOf(car).some(([cx, cy]) => occ[cy * SIZE + cx])) continue;
    for (const [cx, cy] of cellsOf(car)) occ[cy * SIZE + cx] = 1;
    cars.push(car);
  }
  return cars;
}

/** Mutate: add / remove / nudge / flip / relocate one non-red car. */
function mutate(rnd: () => number, cars: Car[]): Car[] {
  const next = cars.map((c) => ({ ...c }));
  const roll = rnd();
  const occFor = (skip: number): Uint8Array => {
    const occ = new Uint8Array(SIZE * SIZE);
    next.forEach((c, i) => {
      if (i === skip) return;
      for (const [cx, cy] of cellsOf(c)) occ[cy * SIZE + cx] = 1;
    });
    return occ;
  };
  const fits = (car: Car, occ: Uint8Array) =>
    !(car.horiz && car.y === RED_ROW) &&
    car.x >= 0 && car.y >= 0 &&
    (car.horiz ? car.x + car.len <= SIZE : car.x < SIZE) &&
    (car.horiz ? car.y < SIZE : car.y + car.len <= SIZE) &&
    !cellsOf(car).some(([cx, cy]) => occ[cy * SIZE + cx]);
  if (roll < 0.12 && next.length < 14) {
    const occ = occFor(-1);
    for (let t = 0; t < 30; t++) {
      const horiz = rnd() < 0.5;
      const len = rnd() < 0.7 ? 2 : 3;
      const car: Car = {
        id: next.length,
        x: randInt(rnd, horiz ? SIZE - len + 1 : SIZE),
        y: randInt(rnd, horiz ? SIZE : SIZE - len + 1),
        len,
        horiz,
      };
      if (fits(car, occ)) {
        next.push(car);
        return next;
      }
    }
    return next;
  }
  if (next.length < 3) return next;
  const i = 1 + randInt(rnd, next.length - 1);
  if (roll < 0.2 && next.length > 7) {
    next.splice(i, 1);
    return next.map((c, k) => ({ ...c, id: k }));
  }
  const occ = occFor(i);
  const old = next[i]!;
  for (let t = 0; t < 30; t++) {
    let car: Car;
    if (roll < 0.55) {
      const sh = (rnd() < 0.5 ? -1 : 1) * (1 + randInt(rnd, 2));
      car = old.horiz ? { ...old, x: old.x + sh } : { ...old, y: old.y + sh };
    } else if (roll < 0.7) {
      const horiz = !old.horiz;
      const len = rnd() < 0.3 ? (old.len === 2 ? 3 : 2) : old.len;
      car = { id: old.id, x: Math.min(old.x, horiz ? SIZE - len : SIZE - 1), y: Math.min(old.y, horiz ? SIZE - 1 : SIZE - len), len, horiz };
    } else {
      const { horiz, len } = old;
      car = { id: old.id, x: randInt(rnd, horiz ? SIZE - len + 1 : SIZE), y: randInt(rnd, horiz ? SIZE : SIZE - len + 1), len, horiz };
    }
    if (!fits(car, occ)) continue;
    next[i] = car;
    return next;
  }
  return next;
}

export type GenOptions = { maxIterations?: number };

const cache = new Map<string, Puzzle>();

/**
 * Deterministic puzzle for a UTC day. Seeded random boards are improved by hill climbing
 * until par lands inside the weekday band; the band widens if it cannot be hit.
 */
export function puzzleForDay(day: string, opts: GenOptions = {}): Puzzle {
  const cached = cache.get(day);
  if (cached && !opts.maxIterations) return cached;
  const rnd = mulberry32(fnv1a('gridlock-' + day));
  const [lo0, hi0] = bandFor(day);
  const maxIt = opts.maxIterations ?? 1800;
  let best: { cars: Car[]; par: number } | null = null;
  let widen = 0;
  let curCars: Car[] | null = null;
  let curPar = -1;
  let stale = 0;
  let found: { cars: Car[]; par: number } | null = null;
  const dist = (par: number) => (par < lo0 - widen ? lo0 - widen - par : par > hi0 + widen ? par - hi0 - widen : 0);
  for (let it = 0; it < maxIt && !found; it++) {
    widen = Math.floor(it / 600); // relax: widen band by 1 every 600 iterations
    if (!curCars || stale > 160) {
      const base = randomBoard(rnd, 8 + randInt(rnd, 6));
      const r = solve(base, undefined, 60000);
      stale = 0;
      if (!r) {
        curCars = null;
        continue;
      }
      curCars = base;
      curPar = r.par;
    } else {
      const cand = mutate(rnd, curCars);
      if (!validBoard(cand)) {
        stale++;
        continue;
      }
      const r = solve(cand, undefined, 60000);
      if (!r) {
        stale++;
        continue;
      }
      const dOld = dist(curPar);
      const dNew = dist(r.par);
      if (dNew < dOld) stale = 0;
      else stale++;
      if (dNew <= dOld) {
        curCars = cand;
        curPar = r.par;
      }
    }
    if (curCars && dist(curPar) === 0) found = { cars: curCars, par: curPar };
    if (curCars && (!best || dist(curPar) < dist(best.par))) best = { cars: curCars, par: curPar };
  }
  let result = found ?? best;
  if (!result) {
    // Always-solvable fallback: a tiny hand-built board.
    const cars: Car[] = [
      { id: 0, x: 0, y: RED_ROW, len: 2, horiz: true },
      { id: 1, x: 2, y: 1, len: 2, horiz: false },
      { id: 2, x: 3, y: 2, len: 3, horiz: false },
    ];
    const r = solve(cars)!;
    result = { cars, par: r.par };
  }
  // renumber ids to 0..n-1 in current order (already contiguous)
  const puzzle: Puzzle = { day, number: puzzleNumber(day), cars: result.cars.map((c, i) => ({ ...c, id: i })), par: result.par };
  if (!opts.maxIterations) cache.set(day, puzzle);
  return puzzle;
}

// ---------- palette / presentation helpers ----------

export const CAR_COLORS = [
  '#e5483b', // red (car 0)
  '#4f8ef7',
  '#f2b134',
  '#4cb782',
  '#a66cf0',
  '#ef7bb0',
  '#35b9c8',
  '#f08a3c',
  '#8d9aa8',
  '#7fb842',
  '#c4786a',
  '#5c6fd6',
  '#d6b25e',
  '#3c9a88',
];

export function carColor(id: number): string {
  return CAR_COLORS[id % CAR_COLORS.length]!;
}

// ---------- streak ----------

export type Streak = { current: number; best: number; last: string | null };

/** Streak after solving `day` (UTC). Past-day solves never change the streak. */
export function nextStreak(prev: Streak, day: string, today: string): Streak {
  if (day !== today) return prev;
  if (prev.last === day) return prev;
  const current = prev.last === addDays(day, -1) ? prev.current + 1 : 1;
  return { current, best: Math.max(prev.best, current), last: day };
}

/** The streak a player should see on a given day (a missed day shows 0). */
export function visibleStreak(s: Streak, today: string): number {
  if (!s.last) return 0;
  return s.last === today || s.last === addDays(today, -1) ? s.current : 0;
}

// ---------- share text ----------

export function shareText(p: { number: number; moves: number; par: number; streak: number; hints: boolean }): string {
  const diff = p.moves - p.par;
  const grid =
    p.moves === p.par ? '🟩'.repeat(Math.min(p.par, 10)) : '🟩'.repeat(Math.min(p.par, 10)) + '🟨'.repeat(Math.min(diff, 6));
  const parts = [`Gridlock Daily #${p.number}`, `${p.moves} moves (par ${p.par})`];
  if (p.streak > 1) parts.push(`streak ${p.streak}`);
  if (p.hints) parts.push('hints used');
  return `${parts.join('  ')}\n🚗 ${grid} 🏁`;
}
