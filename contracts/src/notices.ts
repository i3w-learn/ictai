import { z } from 'zod';
import { Id } from './common.js';

// PRD 4.3 / 5 "Notices": one-way messages from staff to students. A notice is for the whole school,
// one class, or one section of a class. Students only read them.
export const NOTICE_BODY_MAX = 2000;

export const NoticeInput = z
  .object({
    title: z.string().trim().min(1, 'Give the notice a title').max(120),
    body: z.string().trim().max(NOTICE_BODY_MAX).default(''),
    // null class = the whole school. A section only makes sense inside a class.
    classId: Id.nullable().default(null),
    sectionId: Id.nullable().default(null),
    // Pinned notices stay on top of the student's list.
    pinned: z.boolean().default(false),
    // The notice stops showing to students after this moment. null = until someone deletes it.
    expiresAt: z.number().int().positive().nullable().default(null),
  })
  .refine((n) => n.sectionId === null || n.classId !== null, { message: 'Pick the class of that section', path: ['classId'] });
export type NoticeInput = z.infer<typeof NoticeInput>;

export const Notice = z.object({
  id: z.string(),
  title: z.string(),
  body: z.string(),
  classId: z.string().nullable(),
  className: z.string().nullable(),
  sectionId: z.string().nullable(),
  sectionName: z.string().nullable(),
  pinned: z.boolean(),
  expiresAt: z.number().nullable(),
  // Staff see a notice whose time is up marked as expired; students never receive one.
  expired: z.boolean(),
  byName: z.string(),
  createdAt: z.number(),
});
export type Notice = z.infer<typeof Notice>;
