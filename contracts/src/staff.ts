import { z } from 'zod';
import { Id } from './common.js';
import { StaffRole } from './permissions.js';

// Spec 4.1: the Super Admin manages teacher accounts. Super Admins themselves come
// from the installer now and the signed field-person list in M4.
export const StaffMember = z.object({
  id: z.string(),
  username: z.string(),
  displayName: z.string(),
  role: StaffRole,
  canHostLessons: z.boolean(),
  canUploadContent: z.boolean(),
  status: z.enum(['active', 'disabled']),
  classIds: z.array(z.string()),
  subjects: z.array(z.string()),
});
export type StaffMember = z.infer<typeof StaffMember>;

const Password = z.string().min(8, 'Password must be at least 8 characters').max(200);
const ClassIds = z.array(Id).min(1, 'Pick at least one class').max(50);
const Subjects = z.array(z.string().trim().min(1).max(60)).min(1, 'Type at least one subject').max(20);

export const NewTeacher = z.object({
  username: z.string().trim().min(1).max(64),
  displayName: z.string().trim().min(1).max(80),
  password: Password,
  classIds: ClassIds,
  subjects: Subjects,
});
export type NewTeacher = z.infer<typeof NewTeacher>;

export const UpdateTeacher = z
  .object({
    displayName: z.string().trim().min(1).max(80),
    canHostLessons: z.boolean(),
    canUploadContent: z.boolean(),
    status: z.enum(['active', 'disabled']),
    classIds: ClassIds,
    subjects: Subjects,
  })
  .partial()
  .refine((u) => Object.keys(u).length > 0, 'Nothing to change');
export type UpdateTeacher = z.infer<typeof UpdateTeacher>;

export const SetPassword = z.object({ password: Password });
