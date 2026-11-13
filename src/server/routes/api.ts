import { Hono } from 'hono';
import { context, redis, reddit } from '@devvit/web/server';
import { replay, shareText, utcDay } from '../../shared/puzzle';
import type {
  ErrorResponse,
  LeaderboardResponse,
  MyResult,
  ShareCommentResponse,
  SubmitRequest,
  SubmitResponse,
  TodayResponse,
} from '../../shared/api';
import {
  currentUsername,
  getPuzzle,
  isBetter,
  keys,
  rankOf,
  readHistogram,
  readResult,
  readSolveCount,
  readStreak,
  requestDay,
  scoreOf,
  streakView,
  toDto,
  topEntries,
  writeStreak,
} from '../core/store';

export const api = new Hono();

const TTL_SECONDS = 60 * 60 * 24 * 60;

const fail = (message: string) => ({ status: 'error', message }) satisfies ErrorResponse;

api.get('/today', async (c) => {
  try {
    const day = requestDay();
    const [puzzle, username] = await Promise.all([getPuzzle(day), currentUsername()]);
    const [histogram, solveCount, result, streak] = await Promise.all([
      readHistogram(day),
      readSolveCount(day),
      username ? readResult(day, username) : Promise.resolve(null),
      username ? readStreak(username) : Promise.resolve({ current: 0, best: 0, last: null }),
    ]);
    return c.json<TodayResponse>({
      type: 'today',
      puzzle: toDto(puzzle),
      isToday: day === utcDay(),
      loggedIn: !!username,
      username,
      result,
      streak: streakView(streak),
      solveCount,
      histogram,
      postId: context.postId ?? null,
    });
  } catch (error) {
    console.error('today failed', error);
    return c.json(fail('Could not load the puzzle. Please try again.'), 500);
  }
});

api.post('/submit', async (c) => {
  let body: SubmitRequest;
  try {
    body = await c.req.json<SubmitRequest>();
  } catch {
    return c.json(fail('Bad request'), 400);
  }
  try {
    const day = requestDay();
    const puzzle = await getPuzzle(day);
    const check = replay(puzzle.cars, body.moves);
    if (!check.ok) return c.json(fail(`That move list is not a valid solution (${check.reason}).`), 422);
    const ms = Math.min(Math.max(Math.round(Number(body.ms) || 0), 0), 24 * 3600 * 1000);
    const result: MyResult = { moves: check.moves, ms, hints: !!body.hints };
    const username = await currentUsername();

    if (!username) {
      const [histogram, solveCount] = await Promise.all([readHistogram(day), readSolveCount(day)]);
      return c.json<SubmitResponse>({
        type: 'submit',
        saved: false,
        improved: false,
        result,
        rank: null,
        streak: { current: 0, best: 0 },
        solveCount,
        histogram,
        par: puzzle.par,
      });
    }

    const previous = await readResult(day, username);
    let improved = false;
    let stored = result;
    if (!previous) {
      improved = true;
      await redis.hSet(keys.res(day), { [username]: JSON.stringify(result) });
      await redis.incrBy(keys.solves(day), 1);
      await redis.hIncrBy(keys.hist(day), String(result.moves), 1);
    } else if (isBetter(result, previous)) {
      improved = true;
      await redis.hSet(keys.res(day), { [username]: JSON.stringify(result) });
      await redis.hIncrBy(keys.hist(day), String(previous.moves), -1);
      await redis.hIncrBy(keys.hist(day), String(result.moves), 1);
    } else {
      stored = previous;
    }
    if (improved) {
      if (!stored.hints) await redis.zAdd(keys.lb(day), { member: username, score: scoreOf(stored.moves, stored.ms) });
      else await redis.zRem(keys.lb(day), [username]);
    }
    for (const k of [keys.res(day), keys.hist(day), keys.solves(day), keys.lb(day)]) {
      await redis.expire(k, TTL_SECONDS);
    }
    const streak = await writeStreak(username, day);
    const [histogram, solveCount, rank] = await Promise.all([
      readHistogram(day),
      readSolveCount(day),
      stored.hints ? Promise.resolve(null) : rankOf(day, username),
    ]);
    return c.json<SubmitResponse>({
      type: 'submit',
      saved: true,
      improved,
      result: stored,
      rank,
      streak: streakView(streak),
      solveCount,
      histogram,
      par: puzzle.par,
    });
  } catch (error) {
    console.error('submit failed', error);
    return c.json(fail('Could not save your result. Please try again.'), 500);
  }
});

api.get('/leaderboard', async (c) => {
  try {
    const day = requestDay();
    const username = await currentUsername();
    const entries = await topEntries(day, 10);
    let me = entries.find((e) => e.username === username) ?? null;
    if (!me && username) {
      const rank = await rankOf(day, username);
      const mine = await readResult(day, username);
      if (rank && mine && !mine.hints) me = { rank, username, moves: mine.moves, ms: mine.ms };
    }
    const total = await redis.zCard(keys.lb(day));
    return c.json<LeaderboardResponse>({ type: 'leaderboard', day, entries, me, total });
  } catch (error) {
    console.error('leaderboard failed', error);
    return c.json(fail('Could not load the leaderboard.'), 500);
  }
});

// Optional, explicit user action: post the result as a comment from the player's own account.
api.post('/share-comment', async (c) => {
  try {
    const username = await currentUsername();
    const postId = context.postId;
    if (!username || !postId) return c.json(fail('Log in to share a comment.'), 401);
    const day = requestDay();
    const [puzzle, mine, streak] = await Promise.all([getPuzzle(day), readResult(day, username), readStreak(username)]);
    if (!mine) return c.json(fail('Solve the puzzle first.'), 400);
    const text = shareText({
      number: puzzle.number,
      moves: mine.moves,
      par: puzzle.par,
      streak: streakView(streak).current,
      hints: mine.hints,
    });
    await reddit.submitComment({ id: postId, text, runAs: 'USER' });
    return c.json<ShareCommentResponse>({ type: 'share-comment', ok: true, message: 'Comment posted' });
  } catch (error) {
    console.error('share-comment failed', error);
    return c.json(fail('Could not post the comment.'), 500);
  }
});
