import { createDailyPost } from './store';
import { utcDay } from '../../shared/puzzle';

/** Posts today's puzzle (once per UTC day). */
export const createPost = async () => createDailyPost(utcDay());
