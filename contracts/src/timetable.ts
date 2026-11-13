import { z } from 'zod';
import { Id } from './common.js';
import { Period } from './settings.js';

// PRD 4.2 "Timetable": the weekly grid of who has the lab in which period. The school has one lab,
// so a period on a day holds one class (or one section of it). That is the clash check.
export const SCHOOL_DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
// 1 = Monday ... 6 = Saturday. Sunday has no lab periods.
export const Day = z.number().int().min(1).max(SCHOOL_DAYS.length);

export const SlotKey = z.object({ day: Day, periodId: Id });
export const SlotQuery = z.object({ day: z.coerce.number().int().min(1).max(SCHOOL_DAYS.length), periodId: Id });

export const SlotInput = SlotKey.extend({
  classId: Id,
  sectionId: Id.nullable().default(null),
  subject: z.string().trim().max(60).nullable().default(null).transform((s) => s || null),
});
export type SlotInput = z.infer<typeof SlotInput>;

export const Slot = z.object({
  day: z.number(),
  periodId: z.string(),
  classId: z.string(),
  className: z.string(),
  sectionId: z.string().nullable(),
  sectionName: z.string().nullable(),
  subject: z.string().nullable(),
});
export type Slot = z.infer<typeof Slot>;

export const Timetable = z.object({ periods: z.array(Period), slots: z.array(Slot) });
export type Timetable = z.infer<typeof Timetable>;

// What a student's home screen shows: their own lab periods for today, in time order.
export const LabPeriodToday = z.object({ periodName: z.string(), start: z.string(), end: z.string(), subject: z.string().nullable() });
export const StudentToday = z.object({ dayName: z.string().nullable(), periods: z.array(LabPeriodToday) });
export type StudentToday = z.infer<typeof StudentToday>;

// JavaScript's getDay() (0 = Sunday) as a school day number, or null on Sunday.
export const schoolDayOf = (date: Date): number | null => (date.getDay() === 0 ? null : date.getDay());
