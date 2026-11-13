import { z } from 'zod';
import { Id } from './common.js';
import { ContentItem } from './content.js';

// PRD 4.3 "Playlists" and "Learning paths", and the student app's "Things to do".
// Both are an ordered list of steps for one class. A playlist is library items to go through in order.
// A learning path may also hold pieces of work, and remembers for each student which steps are done.
export const SequenceType = z.enum(['playlist', 'path']);
export type SequenceType = z.infer<typeof SequenceType>;
export const StepKind = z.enum(['content', 'work']);
export type StepKind = z.infer<typeof StepKind>;
export const MAX_STEPS = 30;

export const StepInput = z.object({ kind: StepKind, refId: Id });
export const SequenceInput = z.object({
  type: SequenceType,
  title: z.string().trim().min(1, 'Give it a title').max(120),
  classId: Id,
  subject: z.string().trim().max(60).nullable().default(null).transform((s) => s || null),
  steps: z.array(StepInput).min(1, 'Add at least one step').max(MAX_STEPS),
});
export type SequenceInput = z.infer<typeof SequenceInput>;

export const SequenceStep = z.object({
  id: z.string(),
  kind: StepKind,
  title: z.string(),
  // The library item for a content step (null if it was removed from the library since).
  content: ContentItem.nullable(),
  // The piece of work for a work step.
  workId: z.string().nullable(),
  // false when the item or work behind the step has been removed; the step is then skipped.
  available: z.boolean(),
});
export type SequenceStep = z.infer<typeof SequenceStep>;

export const Sequence = z.object({
  id: z.string(),
  type: SequenceType,
  title: z.string(),
  classId: z.string(),
  className: z.string(),
  subject: z.string().nullable(),
  byName: z.string(),
  createdAt: z.number(),
  steps: z.array(SequenceStep),
  // For a learning path: students of the class, and how many have done every step.
  students: z.number(),
  finished: z.number(),
});
export type Sequence = z.infer<typeof Sequence>;

// What the student sees under "Things to do": each step with a tick, and which step comes next.
export const TodoStep = SequenceStep.extend({ done: z.boolean() });
export type TodoStep = z.infer<typeof TodoStep>;
export const Todo = z.object({
  id: z.string(),
  type: SequenceType,
  title: z.string(),
  subject: z.string().nullable(),
  byName: z.string(),
  steps: z.array(TodoStep),
  doneSteps: z.number(),
  nextStepId: z.string().nullable(),
});
export type Todo = z.infer<typeof Todo>;
