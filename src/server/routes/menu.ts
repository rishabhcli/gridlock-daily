import { Hono } from 'hono';
import type { UiResponse } from '@devvit/web/shared';
import { context } from '@devvit/web/server';
import { createDailyPost } from '../core/store';
import { utcDay } from '../../shared/puzzle';

export const menu = new Hono();

menu.post('/post-create', async (c) => {
  try {
    const day = utcDay();
    // Moderators can always post; if today's post already exists we still create another on request.
    const res = await createDailyPost(day, true);
    return c.json<UiResponse>(
      { navigateTo: `https://reddit.com/r/${context.subredditName}/comments/${res.postId.replace(/^t3_/, '')}` },
      200
    );
  } catch (error) {
    console.error(`Error creating post: ${error}`);
    return c.json<UiResponse>({ showToast: 'Failed to create post' }, 400);
  }
});
