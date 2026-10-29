import { z } from 'zod';
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
});
export type StaffMember = z.infer<typeof StaffMember>;

const Password = z.string().min(8, 'Password must be at least 8 characters').max(200);

export const NewTeacher = z.object({
  username: z.string().trim().min(1).max(64),
  displayName: z.string().trim().min(1).max(80),
  password: Password,
});
export type NewTeacher = z.infer<typeof NewTeacher>;

export const UpdateTeacher = z
  .object({
    displayName: z.string().trim().min(1).max(80),
    canHostLessons: z.boolean(),
    canUploadContent: z.boolean(),
    status: z.enum(['active', 'disabled']),
  })
  .partial()
  .refine((u) => Object.keys(u).length > 0, 'Nothing to change');
export type UpdateTeacher = z.infer<typeof UpdateTeacher>;

export const SetPassword = z.object({ password: Password });
