import { z } from 'zod';

// Spec 3: permission keys, checked on every route and relay message.
export const PERMISSIONS = [
  'staff.manage',
  'students.manage',
  'setup.devices',
  'setup.master',
  'setup.content',
  'setup.timetable',
  'teaching.manage',
  'lesson.start',
  'lesson.control',
  'lesson.present',
  'screen.watch',
  'results.view',
  'results.view.own',
  'ai.teacher',
  'ai.tutor',
  'licence.view',
  'updates.view',
  'licence.renew',
  'updates.install',
  'settings.manage',
  'server.manage',
] as const;
export const Permission = z.enum(PERMISSIONS);
export type Permission = z.infer<typeof Permission>;

export const StaffRole = z.enum(['super_admin', 'teacher']);
export type StaffRole = z.infer<typeof StaffRole>;
