import { z } from 'zod';
import { Id } from './common.js';
import { ContentItem, type ContentKind } from './content.js';

// "Show to class": a teacher opens a library video and shows it to a class. The same video opens on
// every student PC of that class by itself, and when the teacher plays, pauses or skips, every screen
// does the same. Each PC still reads the video from the Server PC itself; only the teacher's play,
// pause and place travel, as one small message. All of it stays inside the lab, with no internet.
//
// A show lives in the server's memory only: it is about this lesson, right now. It ends when the
// teacher stops it or leaves the video, and also by itself when the teacher's app goes quiet
// (closed, crashed, cable pulled), so a class is never left with a video stuck on their screens.
// The teacher's app says "still here" every SHOW_BEAT_MS. The app itself says it, not its page: a
// page whose window is hidden or covered is slowed down by the computer and may say nothing for a
// long time, which must not end a show the teacher is still giving.
export const SHOW_BEAT_MS = 5_000;
export const SHOW_STALE_MS = 20_000;

// What is being shown. A video plays; a PDF, a picture and a whiteboard are shown page by page, and
// every screen of the class is on the page the teacher is on. A picture is one page. A whiteboard is
// a show with no file: only blank pages to write on.
export const ShowKind = z.enum(['video', 'pdf', 'image', 'whiteboard']);
export type ShowKind = z.infer<typeof ShowKind>;

// Start showing a library item (video, PDF or picture), or a blank whiteboard to one class.
export const ShowStart = z.union([z.object({ contentId: Id }), z.object({ whiteboard: z.literal(true), classId: Id })]);
export type ShowStart = z.infer<typeof ShowStart>;

// Move every screen to `page`. The teacher's app sends `pages` once for a PDF, after opening the file
// and counting its pages. A whiteboard sends `pages` one higher to add a page.
// The most pages any show may have, so a page number from a screen is never unbounded.
export const SHOW_PAGES_MAX = 5000;
export const ShowPage = z.object({
  page: z.number().int().min(1).max(SHOW_PAGES_MAX),
  pages: z.number().int().min(1).max(SHOW_PAGES_MAX).optional(),
});
export type ShowPage = z.infer<typeof ShowPage>;
// The most pages a whiteboard may have, so one show cannot fill the server's memory.
export const WHITEBOARD_PAGES_MAX = 30;

// What each kind of show is, in one place. `library`: it is a library item a teacher can show (a
// whiteboard is not; it has no file). `pages`, how its pages work:
//   none: a video has no pages (it is always on page 1)
//   counted: a PDF; the teacher's app counts the pages after opening the file
//   one: a picture is one page
//   grows: a whiteboard starts with one page and gains one at a time, up to WHITEBOARD_PAGES_MAX
export const SHOW_KINDS = {
  video: { library: true, pages: 'none' },
  pdf: { library: true, pages: 'counted' },
  image: { library: true, pages: 'one' },
  whiteboard: { library: false, pages: 'grows' },
} as const satisfies Record<ShowKind, { library: boolean; pages: 'none' | 'counted' | 'one' | 'grows' }>;

// The kinds of library item that can be shown to a class.
export type ShowableKind = { [K in ShowKind]: (typeof SHOW_KINDS)[K]['library'] extends true ? K : never }[ShowKind];
export function canShow(kind: ContentKind | ShowKind): kind is ShowableKind {
  return kind in SHOW_KINDS && SHOW_KINDS[kind as ShowKind].library;
}

// How many pages a show of this kind has when it starts: null while not yet known (a PDF), or for a video.
export function startingPages(kind: ShowKind): number | null {
  const rule = SHOW_KINDS[kind].pages;
  return rule === 'one' || rule === 'grows' ? 1 : null;
}
// Every screen draws the whiteboard in this shape (wide, like a projector), with plain bars where a
// screen is a different shape, so writing lands on the same spot of the board everywhere.
export const WHITEBOARD_ASPECT = 16 / 9;

// Where the teacher's player is. `position` is seconds into the video.
export const ShowUpdate = z.object({
  playing: z.boolean(),
  position: z.number().min(0).max(24 * 3600),
  rate: z.number().min(0.25).max(4).default(1),
});
export type ShowUpdate = z.infer<typeof ShowUpdate>;

// What a student's screen says about how the video is going on that PC. It is written in the server's
// diary, so whoever looks after the lab can see which PC had trouble.
//   opened: the video came up on the screen      ready: the video loaded and can play
//   waiting: the video is not arriving           recovered: it is arriving again
//   retrying: the screen started the video afresh
//   silent: the PC would not start the sound by itself, so it plays without sound
//   failed: this PC cannot play the video
export const ScreenEvent = z.enum(['opened', 'ready', 'waiting', 'recovered', 'retrying', 'silent', 'failed']);
export type ScreenEvent = z.infer<typeof ScreenEvent>;
export const ScreenReport = z.object({
  event: ScreenEvent,
  // Seconds into the video on this screen, and how far that is behind the teacher (minus = ahead).
  position: z.number().min(0).max(24 * 3600).default(0),
  behind: z.number().min(-24 * 3600).max(24 * 3600).default(0),
});
export type ScreenReport = z.infer<typeof ScreenReport>;
// The most reports one student's screen may make about one show. Past that they are dropped.
export const SCREEN_REPORTS_MAX = 100;

// Where a student's ask for the pen stands: not asked, waiting for the teacher, or the teacher
// said "not now" (until she asks again or the show ends).
export const PenAsk = z.enum(['none', 'waiting', 'refused']);
export type PenAsk = z.infer<typeof PenAsk>;

export const Show = z.object({
  id: z.string(),
  classId: z.string(),
  className: z.string(),
  // Defaults keep a newer screen working with an older server, which knows only videos.
  kind: ShowKind.default('video'),
  // The library item being shown; null for a whiteboard, which has no file.
  item: ContentItem.nullable(),
  byName: z.string(),
  playing: z.boolean(),
  position: z.number(),
  rate: z.number(),
  // The page every screen is on (1 for a video), and how many pages there are, once known: a
  // whiteboard always, a picture 1, a PDF after the teacher's app has counted them, a video never.
  page: z.number().int().min(1).default(1),
  pages: z.number().int().min(1).nullable().default(null),
  // Server clock when the teacher was at `position`, and server clock now. A screen works out where
  // the video should be from these two, so it never needs its own clock to be right.
  at: z.number(),
  now: z.number(),
  // Goes up by one each time the writing on the video changes. A screen that sees a number it did not
  // expect has missed something and asks for all the writing again.
  inkRev: z.number().default(0),
  // The student the teacher has given the pen to, if any.
  pen: z.object({ studentId: z.string(), name: z.string() }).nullable().default(null),
  // The students whose screens have the video open. Only the teacher is told.
  watching: z.array(z.object({ studentId: z.string(), name: z.string() })).optional(),
  // The students asking for the pen, the one who asked first at the top. Only the teacher is told.
  asks: z.array(z.object({ studentId: z.string(), name: z.string() })).optional(),
  // For the student this state was made for: has she asked for the pen, and did the teacher say
  // "not now"? Defaults keep a newer screen working with an older server, which knows no asking.
  myAsk: PenAsk.default('none'),
});
export type Show = z.infer<typeof Show>;

// Where the video should be, `sinceMs` after a screen received `show`.
export function showPosition(show: Pick<Show, 'playing' | 'position' | 'rate' | 'at' | 'now'>, sinceMs = 0): number {
  return show.playing ? show.position + ((show.now - show.at + sinceMs) / 1000) * show.rate : show.position;
}

// The live room a class's screens listen to.
export const showRoom = (classId: string) => `show:${classId}`;

// --- Writing on the video ---
// The teacher (or the one student she gives the pen to) writes on the paused video with a pen, a
// finger or the mouse, and the whole class sees it. Only the pen's path travels, never a picture.
// A place is a share of the video's picture (0 to INK_SCALE across and down), not of the screen, so
// the line lands on the same spot of the picture on a small lab PC and on a big board.
// The writing belongs to the paused moment: it is wiped when the video plays or jumps.
export const INK_SCALE = 10_000;
export const INK_COLOURS = ['red', 'yellow', 'green', 'blue', 'white'] as const;
export const InkColour = z.enum(INK_COLOURS);
export type InkColour = z.infer<typeof InkColour>;
export const INK_WIDTHS = ['thin', 'medium', 'thick'] as const;
export const InkWidth = z.enum(INK_WIDTHS);
export type InkWidth = z.infer<typeof InkWidth>;
// Limits, so no screen can fill the server's memory: points in one line, lines on one show, and
// points in one message.
export const INK_POINTS_MAX = 2000;
export const INK_STROKES_MAX = 300;
export const INK_BATCH_MAX = 300;
// Lines on one show across all its pages.
export const INK_SHOW_STROKES_MAX = 1500;

// Points one after another as x, y, pressure, each 0 to INK_SCALE.
const numbers = (maxPoints: number) =>
  z.array(z.number().int().min(0).max(INK_SCALE)).max(maxPoints * 3).refine((a) => a.length % 3 === 0, 'Points come in threes: x, y, pressure.');

// More of one line. The first message for a `strokeId` starts the line.
// `page` is the page of the show the line is written on.
// An older student PC sends no page; it only knows videos, which have one page.
export const InkAdd = z.object({ strokeId: Id, page: z.number().int().min(1).max(SHOW_PAGES_MAX).default(1), colour: InkColour, width: InkWidth, points: numbers(INK_BATCH_MAX) });
export type InkAdd = z.infer<typeof InkAdd>;

export const InkStroke = z.object({
  id: z.string(),
  // 'teacher', or the id of the student who wrote it.
  by: z.string(),
  byName: z.string(),
  page: z.number().int().min(1).default(1),
  colour: InkColour,
  width: InkWidth,
  points: z.array(z.number()),
});
export type InkStroke = z.infer<typeof InkStroke>;

// All the writing on a show right now.
export const Ink = z.object({ rev: z.number(), strokes: z.array(InkStroke) });
export type Ink = z.infer<typeof Ink>;

// One change to the writing, sent to every screen of the class as it happens.
export const InkEvent = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('add'), show: z.string(), rev: z.number(), stroke: InkStroke }),
  z.object({ kind: z.literal('erase'), show: z.string(), rev: z.number(), strokeId: z.string() }),
  // Only the writing on `page` is gone.
  z.object({ kind: z.literal('clear'), show: z.string(), rev: z.number(), page: z.number().int().min(1).default(1) }),
]);
export type InkEvent = z.infer<typeof InkEvent>;

export const StrokeParams = z.object({ id: Id, strokeId: Id });
// Which page to wipe: the one on the teacher's screen, which may be a step ahead of the server's.
// An older teacher's app says no page; then the page the show is on is wiped.
export const InkClearQuery = z.object({ page: z.coerce.number().int().min(1).max(SHOW_PAGES_MAX).optional() });
export type InkClearQuery = z.infer<typeof InkClearQuery>;
// One student's ask for the pen on show `id`.
export const AskParams = z.object({ id: Id, studentId: Id });
// Give the pen to a student whose screen has the video open, or take it back with null.
export const PenGive = z.object({ studentId: Id.nullable() });
export type PenGive = z.infer<typeof PenGive>;
