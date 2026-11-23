import { z } from 'zod';
import { Id } from './common.js';

// Spec 4.3 "Quizzes & polls": a poll is one quick question to the whole class. It has no right
// answer and is never scored: the teacher only sees how many chose what.
// Two kinds: `choice` (pick one of the teacher's options) and `rating` (1 to 5 stars).
export const PollKind = z.enum(['choice', 'rating']);
export type PollKind = z.infer<typeof PollKind>;
export const RATING_MAX = 5;

export const PollInput = z
  .object({
    classId: Id,
    question: z.string().trim().min(1, 'Type the question').max(300),
    kind: PollKind,
    // For a choice poll, 2 to 6 options. A rating poll has none.
    options: z.array(z.string().trim().min(1, 'An option is empty').max(120)).max(6).default([]),
  })
  .refine((p) => (p.kind === 'choice' ? p.options.length >= 2 : p.options.length === 0), { message: 'Give at least two options', path: ['options'] });
export type PollInput = z.infer<typeof PollInput>;

// What staff see: the question and how the class answered. No names: a poll is not a test.
export const Poll = z.object({
  id: z.string(),
  classId: z.string(),
  className: z.string(),
  question: z.string(),
  kind: PollKind,
  options: z.array(z.string()),
  open: z.boolean(),
  // How many chose each option, in the order of `options`; for a rating, how many gave 1, 2 … 5 stars.
  counts: z.array(z.number()),
  answered: z.number(),
  // The mean of a rating poll, to one decimal place. null for a choice poll, or when nobody has answered.
  average: z.number().nullable(),
  byName: z.string(),
  createdAt: z.number(),
});
export type Poll = z.infer<typeof Poll>;

// What a student sees: the question, and what they chose (they may change it while the poll is open).
export const PollForStudent = z.object({
  id: z.string(),
  question: z.string(),
  kind: PollKind,
  options: z.array(z.string()),
  // The option's place in the list (from 0), or the number of stars (1 to 5). null = not answered yet.
  myChoice: z.number().nullable(),
});
export type PollForStudent = z.infer<typeof PollForStudent>;

export const PollAnswer = z.object({ choice: z.number().int().min(0).max(RATING_MAX) });
export const PollQuery = z.object({ classId: Id.optional() });

// The live room of a class's polls.
export const pollRoom = (classId: string) => `poll:${classId}`;
