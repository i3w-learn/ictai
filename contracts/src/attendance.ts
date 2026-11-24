import { z } from 'zod';
import { Id } from './common.js';

// Spec 4.4 "Attendance": a student is present on a day when they signed in on a lab PC that day.
// The server marks it by itself; a teacher can change it either way.

// A day written as 2026-11-23. It is the server's own day, so every PC agrees on what "today" is.
export const DayText = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Pick a date');
export const dayText = (date: Date): string =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;

// No date = today.
export const AttendanceQuery = z.object({ classId: Id, date: DayText.optional() });

export const AttendanceRow = z.object({
  studentId: z.string(),
  name: z.string(),
  rollNo: z.string().nullable(),
  sectionName: z.string().nullable(),
  present: z.boolean(),
  // Who says so: the student's own sign-in, or a teacher. null = nobody has marked this student
  // (they did not sign in), which counts as absent.
  by: z.enum(['signin', 'teacher']).nullable(),
  // When they first signed in, or when the teacher marked them.
  at: z.number().nullable(),
});
export type AttendanceRow = z.infer<typeof AttendanceRow>;

export const AttendanceDay = z.object({
  date: z.string(),
  // The server's today, so the screen knows which day is still going on.
  today: z.string(),
  rows: z.array(AttendanceRow),
});
export type AttendanceDay = z.infer<typeof AttendanceDay>;

export const AttendanceMark = z.object({ date: DayText, present: z.boolean() });
export type AttendanceMark = z.infer<typeof AttendanceMark>;
