import { z } from 'zod';

// Spec 4.3 "Activities": a small interactive lesson or game that runs with no internet and tells the
// app the student's score when it is done.
// An activity is ONE web page file (.html) with everything inside it: its own script, styles and
// pictures. The app runs it in a closed box: it cannot reach the network, the rest of the app, or
// anything on the PC. All it can do is show itself and send this message when the student is done:
//
//   parent.postMessage({ ict: 'activity', type: 'done', score: 8, max: 10 }, '*')
//
// See docs/activities.md for how to write one.
export const ActivityDone = z.object({
  ict: z.literal('activity'),
  type: z.literal('done'),
  score: z.number().int().min(0).max(10_000),
  max: z.number().int().min(1).max(10_000),
}).refine((m) => m.score <= m.max);
export type ActivityDone = z.infer<typeof ActivityDone>;

// What the student's app sends the server: the score, and how long the activity was open.
export const ActivityResult = z
  .object({
    score: z.number().int().min(0).max(10_000),
    max: z.number().int().min(1).max(10_000),
    seconds: z.number().int().min(0).max(24 * 3600),
  })
  .refine((r) => r.score <= r.max, { message: 'The score cannot be more than the most there is', path: ['score'] });
export type ActivityResult = z.infer<typeof ActivityResult>;

// What a teacher sees for one activity: every student of the class, with their best try.
export const ActivityScore = z.object({
  studentId: z.string(),
  name: z.string(),
  rollNo: z.string().nullable(),
  // null = has not finished it yet.
  best: z.number().nullable(),
  max: z.number().nullable(),
  tries: z.number(),
  lastAt: z.number().nullable(),
});
export type ActivityScore = z.infer<typeof ActivityScore>;
export const ActivityScores = z.object({ title: z.string(), className: z.string(), rows: z.array(ActivityScore) });
export type ActivityScores = z.infer<typeof ActivityScores>;

// The student's own best try, shown back after they finish.
export const MyActivityBest = z.object({ best: z.number(), max: z.number(), tries: z.number() });
export type MyActivityBest = z.infer<typeof MyActivityBest>;
