import { context, redis, reddit } from '@devvit/web/server';
import {
  addDays,
  isDayString,
  nextStreak,
  puzzleForDay,
  utcDay,
  visibleStreak,
  weekday,
  DAY_NAMES,
  difficultyLabel,
  type Puzzle,
  type Streak,
} from '../../shared/puzzle';
import type { MyResult, PuzzleDto, LeaderEntry } from '../../shared/api';

const TTL_SECONDS = 60 * 60 * 24 * 60;

export const keys = {
  puzzle: (day: string) => `gl:puzzle:${day}`,
  lb: (day: string) => `gl:lb:${day}`,
  res: (day: string) => `gl:res:${day}`,
  hist: (day: string) => `gl:hist:${day}`,
  solves: (day: string) => `gl:solves:${day}`,
  streak: (user: string) => `gl:streak:${user}`,
  posted: (day: string) => `gl:posted:${day}`,
};

export function toDto(p: Puzzle): PuzzleDto {
  return {
    day: p.day,
    number: p.number,
    cars: p.cars,
    par: p.par,
    difficulty: difficultyLabel(p.day),
    weekday: DAY_NAMES[weekday(p.day)]!,
  };
}

/** Puzzle for a day, cached in Redis because hard days take a moment to generate. */
export async function getPuzzle(day: string): Promise<Puzzle> {
  try {
    const cached = await redis.get(keys.puzzle(day));
    if (cached) {
      const p = JSON.parse(cached) as Puzzle;
      if (p.day === day && Array.isArray(p.cars)) return p;
    }
  } catch (e) {
    console.warn('puzzle cache read failed', e);
  }
  const p = puzzleForDay(day);
  try {
    await redis.set(keys.puzzle(day), JSON.stringify(p));
    await redis.expire(keys.puzzle(day), TTL_SECONDS);
  } catch (e) {
    console.warn('puzzle cache write failed', e);
  }
  return p;
}

/** The day this request is about: the post's own day when known, otherwise today (UTC). */
export function requestDay(): string {
  const pd = (context as unknown as { postData?: { day?: unknown } }).postData;
  if (pd && isDayString(pd.day) && pd.day <= utcDay()) return pd.day;
  return utcDay();
}

export async function currentUsername(): Promise<string | null> {
  if (!context.userId) return null;
  try {
    return (await reddit.getCurrentUsername()) ?? null;
  } catch {
    return null;
  }
}

export async function readStreak(user: string): Promise<Streak> {
  const raw = await redis.get(keys.streak(user));
  if (!raw) return { current: 0, best: 0, last: null };
  try {
    const s = JSON.parse(raw) as Streak;
    return { current: s.current | 0, best: s.best | 0, last: s.last ?? null };
  } catch {
    return { current: 0, best: 0, last: null };
  }
}

export function streakView(s: Streak) {
  return { current: visibleStreak(s, utcDay()), best: s.best };
}

export async function writeStreak(user: string, day: string): Promise<Streak> {
  const prev = await readStreak(user);
  const next = nextStreak(prev, day, utcDay());
  if (next !== prev) {
    await redis.set(keys.streak(user), JSON.stringify(next));
  }
  return next;
}

export async function readResult(day: string, user: string): Promise<MyResult | null> {
  const raw = await redis.hGet(keys.res(day), user);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as MyResult;
  } catch {
    return null;
  }
}

export async function readHistogram(day: string): Promise<Record<string, number>> {
  const h = await redis.hGetAll(keys.hist(day));
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(h ?? {})) out[k] = parseInt(v, 10) || 0;
  return out;
}

export async function readSolveCount(day: string): Promise<number> {
  const v = await redis.get(keys.solves(day));
  return v ? parseInt(v, 10) || 0 : 0;
}

/** Lower is better: moves first, then time. */
export function scoreOf(moves: number, ms: number): number {
  return moves * 1e8 + Math.min(Math.max(Math.round(ms), 0), 99_999_999);
}

/** Better = no hints beats hints, then fewer moves, then faster. */
export function isBetter(a: MyResult, than: MyResult): boolean {
  if (a.hints !== than.hints) return !a.hints;
  return scoreOf(a.moves, a.ms) < scoreOf(than.moves, than.ms);
}

export async function rankOf(day: string, user: string): Promise<number | null> {
  const r = await redis.zRank(keys.lb(day), user);
  return r === undefined ? null : r + 1;
}

export async function topEntries(day: string, n = 10): Promise<LeaderEntry[]> {
  const rows = await redis.zRange(keys.lb(day), 0, n - 1, { by: 'rank' });
  return rows.map((r, i) => {
    const moves = Math.floor(r.score / 1e8);
    return { rank: i + 1, username: r.member, moves, ms: Math.round(r.score - moves * 1e8) };
  });
}

export async function dailyPostExists(day: string): Promise<string | undefined> {
  return redis.get(keys.posted(day));
}

/** Creates the custom post for a day unless one exists already. */
export async function createDailyPost(day: string, force = false) {
  const existing = await dailyPostExists(day);
  if (existing && !force) return { created: false as const, postId: existing };
  const p = await getPuzzle(day);
  const title = `Gridlock Daily #${p.number}: ${DAY_NAMES[weekday(day)]}'s sliding-car puzzle (par ${p.par})`;
  const post = await reddit.submitCustomPost({
    title,
    entry: 'default',
    postData: { day },
    textFallback: {
      text:
        `Gridlock Daily #${p.number} (${day}). Slide the cars, free the red one. ` +
        `Par is ${p.par} moves. Open this post in the Reddit app or on new reddit to play. ` +
        `Everyone gets the same puzzle each UTC day, with a fresh one at 00:00 UTC.`,
    },
  });
  await redis.set(keys.posted(day), post.id);
  await redis.expire(keys.posted(day), TTL_SECONDS);
  return { created: true as const, postId: post.id };
}

export { addDays };
