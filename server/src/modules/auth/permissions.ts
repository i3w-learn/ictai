import type { Permission } from '@ict/contracts';

export interface StaffRow {
  role: 'super_admin' | 'teacher';
  can_host_lessons: number;
  can_upload_content: number;
}

const TEACHER: Permission[] = [
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
  'ai.teacher',
  'licence.view',
  'updates.view',
];

const SUPER_ADMIN: Permission[] = [
  ...TEACHER,
  'staff.manage',
  'licence.renew',
  'updates.install',
  'settings.manage',
  'server.manage',
];

const LESSON: Permission[] = ['lesson.start', 'lesson.control', 'lesson.present'];

// Spec 3: permissions are re-read on every request, so switches apply at once.
export function staffPermissions(user: StaffRow): Permission[] {
  if (user.role === 'super_admin') return SUPER_ADMIN;
  return TEACHER.filter((p) => {
    if (!user.can_host_lessons && LESSON.includes(p)) return false;
    if (!user.can_upload_content && p === 'setup.content') return false;
    return true;
  });
}

export const STUDENT_PERMISSIONS: Permission[] = ['results.view.own', 'ai.tutor'];
