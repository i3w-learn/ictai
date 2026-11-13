import { z } from 'zod';
import { Id } from './common.js';
import { SubjectRow } from './results.js';

// PRD 4.4 "Report cards": made from the marks the server already holds, with the teacher's remarks.
// A card moves draft -> published -> frozen. A frozen card can never change again: it keeps the marks
// as they were on the day it was made, whatever happens to quizzes and work afterwards.
export const CardStatus = z.enum(['draft', 'published', 'frozen']);
export type CardStatus = z.infer<typeof CardStatus>;

// The marks as they stood when the card was made (or last refreshed while a draft).
export const CardMarks = z.object({
  quizzes: z.object({ taken: z.number(), average: z.number().nullable(), grade: z.string().nullable() }),
  subjects: z.array(SubjectRow),
  work: z.object({ marked: z.number(), marksPercent: z.number().nullable() }),
  takenAt: z.number(),
});
export type CardMarks = z.infer<typeof CardMarks>;

export const ReportCard = z.object({
  id: z.string(),
  term: z.string(),
  status: CardStatus,
  remarks: z.string(),
  student: z.object({ id: z.string(), name: z.string(), rollNo: z.string().nullable(), className: z.string(), sectionName: z.string().nullable() }),
  marks: CardMarks,
});
export type ReportCard = z.infer<typeof ReportCard>;

const Term = z.string().trim().min(1, 'Name the term, e.g. Term 1 2026').max(40);
export const MakeCards = z.object({ classId: Id, term: Term });
export const CardsQuery = z.object({ classId: Id, term: Term });
export const CardRemarks = z.object({ remarks: z.string().trim().max(600) });
export const CardStatusChange = z.object({ status: CardStatus });
export const MakeCardsResult = z.object({ made: z.number(), refreshed: z.number(), kept: z.number(), cards: z.array(ReportCard) });
export type MakeCardsResult = z.infer<typeof MakeCardsResult>;

// The only moves allowed. Frozen has none: it is the end.
export const CARD_MOVES: Record<CardStatus, CardStatus[]> = { draft: ['published'], published: ['draft', 'frozen'], frozen: [] };
