import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  addDays,
  bandFor,
  nextStreak,
  puzzleForDay,
  puzzleNumber,
  replay,
  shareText,
  solve,
  validBoard,
  visibleStreak,
  weekday,
  type Car,
  type Move,
} from './puzzle.ts';

const START = '2026-11-16';

test('puzzle numbers start at Day 1 on 2026-11-16', () => {
  assert.equal(puzzleNumber('2026-11-16'), 1);
  assert.equal(puzzleNumber('2026-11-18'), 3);
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(weekday('2026-11-16'), 1); // Monday
});

test('same date gives the same board (fresh generation)', () => {
  const a = puzzleForDay('2026-12-03');
  const b = puzzleForDay('2026-12-03', { maxIterations: 1800 }); // bypasses cache
  assert.deepEqual(a.cars, b.cars);
  assert.equal(a.par, b.par);
  assert.notDeepEqual(puzzleForDay('2026-12-04').cars, a.cars);
});

test('200 consecutive days are valid, solvable, par-correct and in band', () => {
  let inBand = 0;
  for (let i = 0; i < 200; i++) {
    const day = addDays(START, i);
    const p = puzzleForDay(day);
    assert.ok(validBoard(p.cars), `${day} board valid`);
    assert.equal(p.number, i + 1);
    const s = solve(p.cars);
    assert.ok(s, `${day} solvable`);
    assert.equal(s.par, p.par, `${day} par matches BFS`);
    assert.ok(p.par >= 1);
    const r = replay(p.cars, s.moves);
    assert.ok(r.ok, `${day} optimal solution replays`);
    const [lo, hi] = bandFor(day);
    if (p.par >= lo && p.par <= hi) inBand++;
    assert.ok(p.par >= lo - 4 && p.par <= hi + 4, `${day} par ${p.par} within relaxed band`);
  }
  assert.ok(inBand >= 180, `most days hit their band (${inBand}/200)`);
});

test('every weekday band is reachable', () => {
  const seen = new Set<number>();
  for (let i = 0; i < 28; i++) {
    const day = addDays(START, i);
    const p = puzzleForDay(day);
    const [lo, hi] = bandFor(day);
    if (p.par >= lo && p.par <= hi) seen.add(weekday(day));
  }
  assert.equal(seen.size, 7);
});

const small: Car[] = [
  { id: 0, x: 0, y: 2, len: 2, horiz: true },
  { id: 1, x: 2, y: 1, len: 2, horiz: false },
  { id: 2, x: 3, y: 2, len: 3, horiz: false },
];

test('replay validator: legal solution accepted, bad sequences rejected', () => {
  const s = solve(small)!;
  assert.ok(replay(small, s.moves).ok);
  assert.equal(replay(small, []).ok, false);
  // red can't jump the blocker
  assert.equal(replay(small, [{ carId: 0, delta: 4 }]).ok, false);
  // short sequence that doesn't solve
  assert.equal(replay(small, s.moves.slice(0, -1)).ok, false);
  // illegal: car 1 is vertical, slide beyond board
  assert.equal(replay(small, [{ carId: 1, delta: 9 }, ...s.moves]).ok, false);
  // unknown car, zero and fractional delta
  assert.equal(replay(small, [{ carId: 77, delta: 1 }, ...s.moves]).ok, false);
  assert.equal(replay(small, [{ carId: 1, delta: 0 }, ...s.moves]).ok, false);
  assert.equal(replay(small, [{ carId: 1, delta: 0.5 }, ...s.moves]).ok, false);
  assert.equal(replay(small, 'nope').ok, false);
  assert.equal(replay(small, [null]).ok, false);
  // moves after solved are rejected
  const extra: Move[] = [...s.moves, { carId: 1, delta: 1 }];
  assert.equal(replay(small, extra).ok, false);
});

test('multi-cell slide counts as one move', () => {
  const cars: Car[] = [{ id: 0, x: 0, y: 2, len: 2, horiz: true }];
  const s = solve(cars)!;
  assert.equal(s.par, 1);
  assert.deepEqual(s.moves, [{ carId: 0, delta: 4 }]);
});

test('streak logic', () => {
  const none = { current: 0, best: 0, last: null };
  const a = nextStreak(none, '2026-11-16', '2026-11-16');
  assert.deepEqual(a, { current: 1, best: 1, last: '2026-11-16' });
  assert.deepEqual(nextStreak(a, '2026-11-16', '2026-11-16'), a); // same day twice
  const b = nextStreak(a, '2026-11-17', '2026-11-17');
  assert.equal(b.current, 2);
  const c = nextStreak(b, '2026-11-20', '2026-11-20'); // gap resets
  assert.deepEqual(c, { current: 1, best: 2, last: '2026-11-20' });
  assert.deepEqual(nextStreak(c, '2026-11-10', '2026-11-20'), c); // old puzzles do not touch streak
  assert.equal(visibleStreak(c, '2026-11-21'), 1);
  assert.equal(visibleStreak(c, '2026-11-22'), 0);
});

test('share text', () => {
  const t = shareText({ number: 3, moves: 7, par: 7, streak: 4, hints: false });
  assert.match(t, /Gridlock Daily #3 {2}7 moves \(par 7\) {2}streak 4/);
  assert.match(shareText({ number: 3, moves: 9, par: 7, streak: 1, hints: true }), /hints used/);
});
