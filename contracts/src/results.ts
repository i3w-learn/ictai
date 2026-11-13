import { z } from 'zod';
import { Id } from './common.js';
import { StaffRole } from './permissions.js';

// Spec 4.4: quiz results in school. Bands follow v2: 60%+ great, 30–59% growing, under 30% needs, no quizzes none.
export const Band = z.enum(['great', 'growing', 'needs', 'none']);
export type Band = z.infer<typeof Band>;

export const ResultsQuery = z.object({ classId: Id.optional() });

export const StudentResultRow = z.object({
  id: z.string(),
  name: z.string(),
  rollNo: z.string().nullable(),
  classId: z.string(),
  className: z.string(),
  sectionName: z.string().nullable(),
  attempts: z.number(),
  average: z.number().nullable(),
  band: Band,
});
export type StudentResultRow = z.infer<typeof StudentResultRow>;

// Students needing help come first.
export const ResultsOverview = z.object({
  classAverage: z.number().nullable(),
  counts: z.object({ great: z.number(), growing: z.number(), needs: z.number(), none: z.number() }),
  students: z.array(StudentResultRow),
});
export type ResultsOverview = z.infer<typeof ResultsOverview>;

export const AttemptRow = z.object({
  runId: z.string(),
  quizTitle: z.string(),
  subject: z.string().nullable(),
  topic: z.string().nullable(),
  at: z.number(),
  score: z.number(),
  totalMarks: z.number(),
  percent: z.number(),
});
export type AttemptRow = z.infer<typeof AttemptRow>;

export const SubjectRow = z.object({ subject: z.string(), attempts: z.number(), average: z.number(), grade: z.string() });
export type SubjectRow = z.infer<typeof SubjectRow>;

export const StudentResults = z.object({
  student: z.object({ id: z.string(), name: z.string(), rollNo: z.string().nullable(), className: z.string(), sectionName: z.string().nullable() }),
  attempts: z.number(),
  average: z.number().nullable(),
  grade: z.string().nullable(),
  subjects: z.array(SubjectRow),
  history: z.array(AttemptRow),
});
export type StudentResults = z.infer<typeof StudentResults>;

export const TeacherActivity = z.object({
  id: z.string(),
  displayName: z.string(),
  username: z.string(),
  role: StaffRole,
  quizzesMade: z.number(),
  runsHeld: z.number(),
  studentsReached: z.number(),
  lastSignInAt: z.number().nullable(),
});
export type TeacherActivity = z.infer<typeof TeacherActivity>;

// PRD student app "How I am doing": the student's own picture, and only their own.
// (Attendance, lessons joined and learning paths are not counted yet: those features do not exist yet.)
export const TryNext = z.discriminatedUnion('kind', [
  // Work past its due date comes first.
  z.object({ kind: z.literal('work'), title: z.string() }),
  // Otherwise the subject the student finds hardest, if it is below "doing great".
  z.object({ kind: z.literal('subject'), subject: z.string(), average: z.number() }),
]);
export type TryNext = z.infer<typeof TryNext>;

export const MyProgress = z.object({
  quizzes: z.object({ taken: z.number(), average: z.number().nullable(), grade: z.string().nullable() }),
  subjects: z.array(SubjectRow),
  recent: z.array(AttemptRow),
  work: z.object({
    set: z.number(),
    handedIn: z.number(),
    // Handed in and not late.
    onTime: z.number(),
    marked: z.number(),
    // Marks earned over marks possible on marked work, as a percent.
    marksPercent: z.number().nullable(),
  }),
  tryNext: TryNext.nullable(),
});
export type MyProgress = z.infer<typeof MyProgress>;
