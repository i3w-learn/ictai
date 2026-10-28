import { z } from 'zod';
import { Id } from './common.js';
import { Pin } from './auth.js';

export const NewClass = z.object({ name: z.string().trim().min(1).max(32) });
export const SchoolClass = z.object({ id: z.string(), name: z.string() });
export type SchoolClass = z.infer<typeof SchoolClass>;

export const NewSection = z.object({ classId: Id, name: z.string().trim().min(1).max(16) });
export const Section = z.object({ id: z.string(), classId: z.string(), name: z.string() });
export type Section = z.infer<typeof Section>;

export const NewStudent = z.object({
  name: z.string().trim().min(1).max(80),
  classId: Id,
  sectionId: Id.nullable().default(null),
  rollNo: z.string().trim().max(16).nullable().default(null),
  pin: Pin.optional(),
});
export type NewStudent = z.infer<typeof NewStudent>;

export const Student = z.object({
  id: z.string(),
  name: z.string(),
  classId: z.string(),
  sectionId: z.string().nullable(),
  rollNo: z.string().nullable(),
  hasPin: z.boolean(),
});
export type Student = z.infer<typeof Student>;

// The QR token is shown once, when the card is made; only its hash is stored.
export const CreatedStudent = Student.extend({ qrToken: z.string() });

export const SetPin = z.object({ pin: Pin });

export const StudentEnrolmentCode = z.object({ code: z.string().regex(/^\d{6}$/), expiresAt: z.number() });

// What the sign-in screen on a lab PC may see: names only.
export const RosterEntry = z.object({ id: z.string(), name: z.string(), rollNo: z.string().nullable() });
export type RosterEntry = z.infer<typeof RosterEntry>;

export const ClassQuery = z.object({ classId: Id });
export const IdParams = z.object({ id: Id });
