import { Hono } from 'hono';
import type { OnAppInstallRequest, TriggerResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { createDailyPost } from '../core/store';
import { utcDay } from '../../shared/puzzle';

export const triggers = new Hono();

triggers.post('/on-app-install', async (c) => {
  try {
    const res = await createDailyPost(utcDay());
    const input = await c.req.json<OnAppInstallRequest>();
    return c.json<TriggerResponse>(
      {
        status: 'success',
        message: `${res.created ? 'Created' : 'Found'} post ${res.postId} in r/${context.subredditName} (trigger: ${input.type})`,
      },
      200
    );
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    return c.json<TriggerResponse>({ status: 'error', message: 'Failed to create post' }, 400);
  }
});
