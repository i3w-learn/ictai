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

export const UpdateStudent = z
  .object({
    name: z.string().trim().min(1).max(80),
    sectionId: Id.nullable(),
    rollNo: z.string().trim().max(16).nullable(),
  })
  .partial()
  .refine((u) => Object.keys(u).length > 0, 'Nothing to change');
export type UpdateStudent = z.infer<typeof UpdateStudent>;

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

// A class's first sign-in codes, made in one go (spec 4.1).
export const ClassCode = z.object({
  studentId: z.string(),
  name: z.string(),
  rollNo: z.string().nullable(),
  code: z.string().regex(/^\d{6}$/),
  expiresAt: z.number(),
});
export type ClassCode = z.infer<typeof ClassCode>;

// A printable sign-in card. Making cards replaces each student's old QR token.
export const SignInCard = ClassCode.extend({ qrToken: z.string() });
export type SignInCard = z.infer<typeof SignInCard>;

// Moves every student of a class into another class (e.g. 7 → 8 at year end).
export const PromoteClass = z.object({ toClassId: Id });
export const PromoteResult = z.object({ moved: z.number() });

export const ClassQuery = z.object({ classId: Id });
export const IdParams = z.object({ id: Id });
