import { z } from 'zod';
import { Id } from './common.js';
import { Question } from './quizzes.js';

// Spec 9: offline AI on the Server PC. Part 1 makes draft quizzes from a topic.
export const AiLanguage = z.enum(['en', 'hi']);
export type AiLanguage = z.infer<typeof AiLanguage>;

export const AiQuizRequest = z.object({
  classId: Id,
  subject: z.string().trim().min(1).max(60),
  topic: z.string().trim().min(1).max(120),
  count: z.number().int().min(1).max(20).default(10),
  language: AiLanguage.default('en'),
});
export type AiQuizRequest = z.infer<typeof AiQuizRequest>;

// One flag per question: ok, or a note telling the teacher what to check.
export const AiFlag = z.object({ ok: z.boolean(), note: z.string().nullable() });
export type AiFlag = z.infer<typeof AiFlag>;

// flags[i] belongs to questions[i]. note says when fewer questions passed than were asked for.
export const AiQuizResult = z.object({
  questions: z.array(Question),
  flags: z.array(AiFlag),
  note: z.string().nullable(),
});
export type AiQuizResult = z.infer<typeof AiQuizResult>;

export const AiJobStatus = z.enum(['queued', 'running', 'done', 'failed']);
export type AiJobStatus = z.infer<typeof AiJobStatus>;

// position is the 1-based place in line while queued, otherwise null.
export const AiJob = z.object({
  id: z.string(),
  kind: z.literal('quiz'),
  status: AiJobStatus,
  position: z.number().nullable(),
  request: AiQuizRequest,
  result: AiQuizResult.nullable(),
  error: z.string().nullable(),
  createdAt: z.number(),
  finishedAt: z.number().nullable(),
});
export type AiJob = z.infer<typeof AiJob>;

export const AiStatus = z.object({
  installed: z.boolean(),
  model: z.string().nullable(),
  ready: z.boolean(),
  queued: z.number(),
});
export type AiStatus = z.infer<typeof AiStatus>;
