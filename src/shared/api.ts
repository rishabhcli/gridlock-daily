import type { Car, Move } from './puzzle';

export type PuzzleDto = {
  day: string;
  number: number;
  cars: Car[];
  par: number;
  difficulty: string;
  weekday: string;
};

export type MyResult = { moves: number; ms: number; hints: boolean };

export type LeaderEntry = { rank: number; username: string; moves: number; ms: number };

export type TodayResponse = {
  type: 'today';
  puzzle: PuzzleDto;
  isToday: boolean;
  loggedIn: boolean;
  username: string | null;
  result: MyResult | null;
  streak: { current: number; best: number };
  solveCount: number;
  histogram: Record<string, number>;
  postId: string | null;
};

export type SubmitRequest = { moves: Move[]; ms: number; hints: boolean };

export type SubmitResponse = {
  type: 'submit';
  saved: boolean; // false for logged-out players
  improved: boolean;
  result: MyResult;
  rank: number | null;
  streak: { current: number; best: number };
  solveCount: number;
  histogram: Record<string, number>;
  par: number;
};

export type LeaderboardResponse = {
  type: 'leaderboard';
  day: string;
  entries: LeaderEntry[];
  me: LeaderEntry | null;
  total: number;
};

export type ShareCommentResponse = { type: 'share-comment'; ok: boolean; message: string };

export type ErrorResponse = { status: 'error'; message: string };
