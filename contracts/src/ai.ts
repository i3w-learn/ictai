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

// Spec 9 /ai/ask, first step: a plain question answered as plain text. Library search and citations come later.
export const AiAskRequest = z.object({
  question: z.string().trim().min(1).max(2000),
  language: AiLanguage.default('en'),
});
export type AiAskRequest = z.infer<typeof AiAskRequest>;

// wait=1 holds the call until the result is ready (or the server's wait limit passes) instead of returning a ticket.
export const AiWaitQuery = z.object({ wait: z.enum(['0', '1']).default('0') });
export type AiWaitQuery = z.infer<typeof AiWaitQuery>;

export const AiAskResult = z.object({ answer: z.string() });
export type AiAskResult = z.infer<typeof AiAskResult>;

// PRD student app "Ask" (AI tutor): a student types a question and gets a hint in simple words.
// The tutor explains the idea; it is told not to hand over the finished answer to a piece of work.
// It answers from the model alone for now: answering from the school's books needs the content library.
export const TUTOR_DAILY_CAP = 10;
export const AiTutorRequest = z.object({ question: z.string().trim().min(1, 'Type your question').max(600) });
export type AiTutorRequest = z.infer<typeof AiTutorRequest>;
export const AiTutorResult = z.object({ answer: z.string() });
export type AiTutorResult = z.infer<typeof AiTutorResult>;

export const AiJobStatus = z.enum(['queued', 'running', 'done', 'failed']);
export type AiJobStatus = z.infer<typeof AiJobStatus>;

// position is the 1-based place in line while queued, otherwise null.
const jobFields = {
  id: z.string(),
  status: AiJobStatus,
  position: z.number().nullable(),
  error: z.string().nullable(),
  createdAt: z.number(),
  finishedAt: z.number().nullable(),
};
export const AiQuizJob = z.object({ ...jobFields, kind: z.literal('quiz'), request: AiQuizRequest, result: AiQuizResult.nullable() });
export type AiQuizJob = z.infer<typeof AiQuizJob>;
export const AiAskJob = z.object({ ...jobFields, kind: z.literal('ask'), request: AiAskRequest, result: AiAskResult.nullable() });
export type AiAskJob = z.infer<typeof AiAskJob>;

// Every AI request is a job of one kind; the kind says which request and result it carries.
export const AiTutorJob = z.object({ ...jobFields, kind: z.literal('tutor'), request: AiTutorRequest, result: AiTutorResult.nullable() });
export type AiTutorJob = z.infer<typeof AiTutorJob>;
// What the student's Ask screen needs: their questions, newest first, and how many they may still ask today.
export const MyTutor = z.object({ leftToday: z.number(), dailyCap: z.number(), jobs: z.array(AiTutorJob) });
export type MyTutor = z.infer<typeof MyTutor>;

export const AiJob = z.discriminatedUnion('kind', [AiQuizJob, AiAskJob, AiTutorJob]);
export type AiJob = z.infer<typeof AiJob>;
export type AiJobKind = AiJob['kind'];
export type AiJobOf<K extends AiJobKind> = Extract<AiJob, { kind: K }>;
export type AiRequestOf<K extends AiJobKind> = Extract<AiJob, { kind: K }>['request'];
export type AiResultOf<K extends AiJobKind> = NonNullable<Extract<AiJob, { kind: K }>['result']>;

export const AiStatus = z.object({
  // false when the Super Admin has switched AI off in Settings.
  enabled: z.boolean(),
  installed: z.boolean(),
  model: z.string().nullable(),
  ready: z.boolean(),
  queued: z.number(),
});
export type AiStatus = z.infer<typeof AiStatus>;
