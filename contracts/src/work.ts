import { z } from 'zod';
import { Id } from './common.js';

// PRD 4.3 "Work" and student app "My work": a teacher sets a piece of work for a class, students hand in
// a written answer, the teacher gives marks and a comment. Handing in again adds a new answer (the old
// ones are kept); the newest is the one that is marked. Files, drawings and photos are not here yet.
export const ANSWER_MAX = 10_000;
// Every hand-in is kept, so there is a limit on how many times one student can hand in one piece of work.
export const MAX_TRIES = 20;

export const AssignmentInput = z
  .object({
    title: z.string().trim().min(1, 'Give the work a title').max(120),
    instructions: z.string().trim().max(4000).default(''),
    classId: Id,
    sectionId: Id.nullable().default(null),
    subject: z.string().trim().max(60).nullable().default(null).transform((s) => s || null),
    // Work handed in after this moment is marked "late". null = no due date.
    dueAt: z.number().int().positive().nullable().default(null),
    maxMarks: z.number().int().min(1, 'Marks must be at least 1').max(100).default(10),
  });
export type AssignmentInput = z.infer<typeof AssignmentInput>;

export const Assignment = z.object({
  id: z.string(),
  title: z.string(),
  instructions: z.string(),
  classId: z.string(),
  className: z.string(),
  sectionId: z.string().nullable(),
  sectionName: z.string().nullable(),
  subject: z.string().nullable(),
  dueAt: z.number().nullable(),
  maxMarks: z.number(),
  byName: z.string(),
  createdAt: z.number(),
  // How far the class has got: students it is for, how many handed in, how many are marked.
  students: z.number(),
  handedIn: z.number(),
  marked: z.number(),
});
export type Assignment = z.infer<typeof Assignment>;

export const Answer = z.object({ body: z.string(), submittedAt: z.number(), late: z.boolean() });
export const Mark = z.object({ marks: z.number(), comment: z.string(), markedAt: z.number() });

// One student's line in the teacher's marking view. `tries` counts every time they handed in.
export const StudentAnswer = z.object({
  studentId: z.string(),
  name: z.string(),
  rollNo: z.string().nullable(),
  answer: Answer.nullable(),
  tries: z.number(),
  mark: Mark.nullable(),
});
export type StudentAnswer = z.infer<typeof StudentAnswer>;

export const AssignmentDetail = z.object({ assignment: Assignment, answers: z.array(StudentAnswer) });
export type AssignmentDetail = z.infer<typeof AssignmentDetail>;

export const MarkInput = z.object({ marks: z.number().int().min(0), comment: z.string().trim().max(500).default('') });
export type MarkInput = z.infer<typeof MarkInput>;
export const MarkParams = z.object({ id: Id, studentId: Id });

export const WorkAnswer = z.object({ body: z.string().trim().min(1, 'Write your answer first').max(ANSWER_MAX) });
export type WorkAnswer = z.infer<typeof WorkAnswer>;

export const WorkStatus = z.enum(['todo', 'submitted', 'marked']);
export type WorkStatus = z.infer<typeof WorkStatus>;

// One piece of work as the student sees it.
export const MyWork = z.object({
  id: z.string(),
  title: z.string(),
  instructions: z.string(),
  subject: z.string().nullable(),
  dueAt: z.number().nullable(),
  maxMarks: z.number(),
  byName: z.string(),
  status: WorkStatus,
  // Not handed in and the due time has passed.
  overdue: z.boolean(),
  answer: Answer.nullable(),
  mark: Mark.nullable(),
});
export type MyWork = z.infer<typeof MyWork>;
