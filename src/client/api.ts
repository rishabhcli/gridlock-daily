import type {
  LeaderboardResponse,
  ShareCommentResponse,
  SubmitRequest,
  SubmitResponse,
  TodayResponse,
} from '../shared/api';

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, init);
  const data = (await res.json().catch(() => null)) as (T & { status?: string; message?: string }) | null;
  if (!res.ok || !data || data.status === 'error') {
    throw new Error((data && data.message) || `Request failed (${res.status})`);
  }
  return data;
}

export const getToday = () => call<TodayResponse>('/api/today');
export const getLeaderboard = () => call<LeaderboardResponse>('/api/leaderboard');
export const submit = (body: SubmitRequest) =>
  call<SubmitResponse>('/api/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
export const shareComment = () => call<ShareCommentResponse>('/api/share-comment', { method: 'POST' });
