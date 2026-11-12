import { z } from 'zod';
import { Id } from './common.js';
import { Permission, StaffRole } from './permissions.js';

export const StaffLogin = z.object({
  username: z.string().trim().min(1).max(64),
  password: z.string().min(1).max(200),
});
export type StaffLogin = z.infer<typeof StaffLogin>;

export const Pin = z.string().regex(/^\d{4}$/, 'PIN must be 4 digits');

export const StudentPinLogin = z.object({ studentId: Id, pin: Pin });
export const StudentQrLogin = z.object({ qrToken: z.string().min(16).max(128) });
export const StudentFirstLogin = z.object({ code: z.string().regex(/^\d{6}$/), pin: Pin });

// Easy sign-in: class, section and roll number, with no PIN. Only a student the teacher has added
// gets in: the class, section and roll number together are that student's ID.
export const StudentRollLogin = z.object({
  classId: Id,
  sectionId: Id.nullable().default(null),
  rollNo: z.string().trim().min(1).max(16),
});

// Roll numbers are matched loosely: "05", "5" and " 5 " are the same student, and so are "a1" and "A1".
export const rollKey = (rollNo: string) => rollNo.trim().toLowerCase().replace(/^0+(?=.)/, '');

export const StaffPrincipal = z.object({
  kind: z.literal('staff'),
  userId: z.string(),
  role: StaffRole,
  username: z.string(),
  displayName: z.string(),
  permissions: z.array(Permission),
  // What the Super Admin let this teacher see. null means everything (the Super Admin, or a teacher with nothing set).
  classIds: z.array(z.string()).nullable(),
  subjects: z.array(z.string()).nullable(),
});

export const StudentPrincipal = z.object({
  kind: z.literal('student'),
  studentId: z.string(),
  name: z.string(),
  classId: z.string(),
  sectionId: z.string().nullable(),
  deviceId: z.string(),
  permissions: z.array(Permission),
});

export const DevicePrincipal = z.object({
  kind: z.literal('device'),
  deviceId: z.string(),
  deviceKind: z.enum(['lab_pc', 'board']),
  name: z.string(),
});

export const Principal = z.discriminatedUnion('kind', [StaffPrincipal, StudentPrincipal, DevicePrincipal]);
export type Principal = z.infer<typeof Principal>;
export type StaffPrincipal = z.infer<typeof StaffPrincipal>;
export type StudentPrincipal = z.infer<typeof StudentPrincipal>;
export type DevicePrincipal = z.infer<typeof DevicePrincipal>;

export const SessionResult = z.object({
  token: z.string(),
  expiresAt: z.number(),
  principal: Principal,
});
export type SessionResult = z.infer<typeof SessionResult>;
