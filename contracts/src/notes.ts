import { z } from 'zod';

// "My notes": a student's own notebook. Only that student can read it; staff cannot.
// Kept on the server so the notes follow the student to any lab PC.
export const MAX_NOTES_PER_STUDENT = 200;
export const NOTE_BODY_MAX = 20_000;

export const NoteInput = z.object({
  title: z.string().trim().min(1).max(120),
  body: z.string().max(NOTE_BODY_MAX).default(''),
  subject: z.string().trim().max(60).nullable().default(null).transform((s) => s || null),
});
export type NoteInput = z.infer<typeof NoteInput>;

export const Note = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  subject: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Note = z.infer<typeof Note>;
