import { Hono } from 'hono';
import type { TaskResponse } from '@devvit/web/server';
import { createDailyPost } from '../core/store';
import { utcDay } from '../../shared/puzzle';

export const scheduler = new Hono();

// Runs at 00:05 UTC every day (see devvit.json). The Redis key makes it safe to run twice.
scheduler.post('/daily-post', async (c) => {
  try {
    const res = await createDailyPost(utcDay());
    console.log(`daily post ${res.created ? 'created' : 'already existed'}: ${res.postId}`);
    return c.json<TaskResponse>({ status: 'ok' }, 200);
  } catch (error) {
    console.error(`daily post failed: ${error}`);
    return c.json<TaskResponse>({ status: 'error' } as TaskResponse, 500);
  }
});
