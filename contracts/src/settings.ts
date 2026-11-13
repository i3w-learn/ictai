import { z } from 'zod';
import { Id } from './common.js';

// PRD 4.5 "Settings" (Super Admin) and student app "Settings".
const Clock = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour time like 09:30');

// One lab period of the school day. Times are the school's own clock, e.g. "09:00" to "09:40".
// A saved period carries its id; a new one is sent without and the server gives it one. The id is what the
// timetable points at, so renaming a period or moving its time keeps its timetable entries.
export const Period = z
  .object({ id: Id.optional(), name: z.string().trim().min(1, 'Name the period').max(40), start: Clock, end: Clock })
  .refine((p) => p.start < p.end, { message: 'A period must end after it starts', path: ['end'] });
export type Period = z.infer<typeof Period>;

export const MAX_PERIODS = 12;

export const SchoolSettings = z.object({
  schoolName: z.string().trim().min(1, 'Type the school name').max(80),
  // Off: nobody can ask the AI for a quiz or an answer, even if the AI kit is installed.
  aiEnabled: z.boolean(),
  periods: z.array(Period).max(MAX_PERIODS),
});
export type SchoolSettings = z.infer<typeof SchoolSettings>;

// The first pair of periods that share any time, in start order; null when none do.
export function overlappingPeriods(periods: Period[]): [Period, Period] | null {
  const sorted = [...periods].sort((a, b) => a.start.localeCompare(b.start));
  for (let i = 1; i < sorted.length; i++) if (sorted[i]!.start < sorted[i - 1]!.end) return [sorted[i - 1]!, sorted[i]!];
  return null;
}

// How one student likes their screens. Kept on the server so it follows the student to any lab PC.
export const TextSize = z.enum(['normal', 'large', 'xlarge']);
export type TextSize = z.infer<typeof TextSize>;
export const StudentPrefs = z.object({
  textSize: TextSize.default('normal'),
  highContrast: z.boolean().default(false),
  // Wider letters and spacing, easier for a child with dyslexia.
  easyFont: z.boolean().default(false),
});
export type StudentPrefs = z.infer<typeof StudentPrefs>;
export const DEFAULT_PREFS: StudentPrefs = { textSize: 'normal', highContrast: false, easyFont: false };
