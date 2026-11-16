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

// What is wrong with something a person typed, in plain words they can act on. The form's own checks
// stop most of it; this is for what gets through (a name that is too long, a web address without http).
const FIELD_WORDS: Record<string, string> = {
  name: 'The name', rollNo: 'The roll number', title: 'The title', url: 'The web address', subject: 'The subject',
  chapter: 'The chapter', displayName: 'The name', username: 'The username', password: 'The password', text: 'The text',
};
export function plainProblem(error: { issues: readonly { code?: string; path: readonly PropertyKey[]; message: string; origin?: unknown; maximum?: unknown; minimum?: unknown }[] }): string {
  const issue = error.issues[0];
  if (!issue) return 'That cannot be saved as it is.';
  const field = String(issue.path.at(-1) ?? '');
  const what = FIELD_WORDS[field] ?? (field && Number.isNaN(Number(field)) ? `"${field}"` : 'This');
  if (issue.code === 'too_big' && issue.origin === 'string') return `${what} is too long. Use at most ${String(issue.maximum)} letters.`;
  if (issue.code === 'too_small' && issue.origin === 'string') return Number(issue.minimum) <= 1 ? `${what} is missing.` : `${what} is too short. Use at least ${String(issue.minimum)} letters.`;
  // A message written for people (our own checks write these) is shown as it is.
  if (issue.code === 'custom') return issue.message;
  return `${what} is not right: ${issue.message}`;
}
