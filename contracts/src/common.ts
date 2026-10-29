import { z } from 'zod';

export const PORTS = { api: 7700, beacon: 7701 } as const;

export const Id = z.string().uuid();

// Every error leaves the server as { code, message } (spec 14).
export const ApiError = z.object({ code: z.string(), message: z.string() });
export type ApiError = z.infer<typeof ApiError>;

export const Health = z.object({
  ok: z.literal(true),
  serverId: z.string(),
  schoolId: z.string().nullable(),
  name: z.string(),
  activated: z.boolean(),
  version: z.string(),
});
export type Health = z.infer<typeof Health>;

// Spec 4.1: one line of the audit log, with names filled in where known.
export const AuditEntry = z.object({
  id: z.number(),
  at: z.number(),
  actorKind: z.enum(['staff', 'student', 'device', 'system']),
  actorName: z.string().nullable(),
  action: z.string(),
  target: z.string().nullable(),
  targetName: z.string().nullable(),
  detail: z.unknown().nullable(),
});
export type AuditEntry = z.infer<typeof AuditEntry>;

export const AuditQuery = z.object({ before: z.coerce.number().int().positive().optional() });
