import { z } from 'zod';
import { Id } from './common.js';
import { ContentItem } from './content.js';

// "Show to class": a teacher opens a library video and shows it to a class. The same video opens on
// every student PC of that class by itself, and when the teacher plays, pauses or skips, every screen
// does the same. Each PC still reads the video from the Server PC itself; only the teacher's play,
// pause and place travel, as one small message. All of it stays inside the lab, with no internet.
//
// A show lives in the server's memory only: it is about this lesson, right now. It ends when the
// teacher stops it or leaves the video, and also by itself when the teacher's app goes quiet
// (closed, crashed, cable pulled), so a class is never left with a video stuck on their screens.
export const SHOW_BEAT_MS = 5_000;
export const SHOW_STALE_MS = 20_000;

export const ShowStart = z.object({ contentId: Id });
export type ShowStart = z.infer<typeof ShowStart>;

// Where the teacher's player is. `position` is seconds into the video.
export const ShowUpdate = z.object({
  playing: z.boolean(),
  position: z.number().min(0).max(24 * 3600),
  rate: z.number().min(0.25).max(4).default(1),
});
export type ShowUpdate = z.infer<typeof ShowUpdate>;

export const Show = z.object({
  id: z.string(),
  classId: z.string(),
  className: z.string(),
  item: ContentItem,
  byName: z.string(),
  playing: z.boolean(),
  position: z.number(),
  rate: z.number(),
  // Server clock when the teacher was at `position`, and server clock now. A screen works out where
  // the video should be from these two, so it never needs its own clock to be right.
  at: z.number(),
  now: z.number(),
});
export type Show = z.infer<typeof Show>;

// Where the video should be, `sinceMs` after a screen received `show`.
export function showPosition(show: Pick<Show, 'playing' | 'position' | 'rate' | 'at' | 'now'>, sinceMs = 0): number {
  return show.playing ? show.position + ((show.now - show.at + sinceMs) / 1000) * show.rate : show.position;
}

// The live room a class's screens listen to.
export const showRoom = (classId: string) => `show:${classId}`;
