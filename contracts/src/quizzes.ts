import { z } from 'zod';
import { Id } from './common.js';

// Spec 4.3, single-choice questions for now. `correct` is the index of the right option.
export const Question = z
  .object({
    text: z.string().trim().min(1).max(500),
    options: z.array(z.string().trim().min(1).max(200)).min(2).max(6),
    correct: z.number().int().min(0),
    marks: z.number().int().min(1).max(10).default(1),
  })
  .refine((q) => q.correct < q.options.length, { message: 'Pick which option is correct', path: ['correct'] });
export type Question = z.infer<typeof Question>;

export const QuizInput = z.object({
  title: z.string().trim().min(1).max(120),
  classId: Id,
  subject: z.string().trim().max(60).nullable().default(null),
  topic: z.string().trim().max(120).nullable().default(null),
  secondsPerQuestion: z.number().int().min(10).max(600).default(300),
  questions: z.array(Question).min(1).max(100),
});
export type QuizInput = z.infer<typeof QuizInput>;

export const Quiz = z.object({
  id: z.string(),
  title: z.string(),
  classId: z.string(),
  subject: z.string().nullable(),
  topic: z.string().nullable(),
  secondsPerQuestion: z.number(),
  questions: z.array(z.object({ text: z.string(), options: z.array(z.string()), correct: z.number(), marks: z.number() })),
  totalMarks: z.number(),
  updatedAt: z.number(),
});
export type Quiz = z.infer<typeof Quiz>;

export const QuizSummary = z.object({
  id: z.string(),
  title: z.string(),
  classId: z.string(),
  subject: z.string().nullable(),
  topic: z.string().nullable(),
  questionCount: z.number(),
  totalMarks: z.number(),
  updatedAt: z.number(),
});
export type QuizSummary = z.infer<typeof QuizSummary>;

export const QuizQuery = z.object({ classId: Id.optional() });

// Lab Mode: a run of one quiz. lobby → active → ended.
export const RunStatus = z.enum(['lobby', 'active', 'ended']);
export type RunStatus = z.infer<typeof RunStatus>;

export const RunParticipant = z.object({
  studentId: z.string(),
  name: z.string(),
  rollNo: z.string().nullable(),
  answered: z.number(),
  correct: z.number(),
  score: z.number(),
  finished: z.boolean(),
});
export type RunParticipant = z.infer<typeof RunParticipant>;

// What the teacher sees. Participants are sorted by score, highest first.
export const TeacherRunState = z.object({
  kind: z.literal('teacher'),
  runId: z.string(),
  quizId: z.string(),
  title: z.string(),
  className: z.string(),
  joinCode: z.string().nullable(),
  status: RunStatus,
  questionCount: z.number(),
  totalMarks: z.number(),
  participants: z.array(RunParticipant),
});
export type TeacherRunState = z.infer<typeof TeacherRunState>;

// What a student sees. Never includes the correct answers.
export const StudentRunState = z.object({
  kind: z.literal('student'),
  runId: z.string(),
  title: z.string(),
  status: RunStatus,
  secondsPerQuestion: z.number(),
  questions: z.array(z.object({ text: z.string(), options: z.array(z.string()) })),
  myAnswers: z.array(z.number().nullable()),
  finished: z.boolean(),
  score: z.number().nullable(),
  totalMarks: z.number(),
});
export type StudentRunState = z.infer<typeof StudentRunState>;

export const RunSummary = z.object({
  id: z.string(),
  quizId: z.string(),
  title: z.string(),
  status: RunStatus,
  joinCode: z.string().nullable(),
  createdAt: z.number(),
  participants: z.number(),
});
export type RunSummary = z.infer<typeof RunSummary>;

export const OpenRun = z.object({ quizId: Id });
export const RunQuery = z.object({ quizId: Id });
export const JoinRun = z.object({ code: z.string().regex(/^\d{6}$/, 'Enter the 6-digit code') });
export const SubmitAnswer = z.object({ questionIndex: z.number().int().min(0), choice: z.number().int().min(0) });
export const AnswerResult = z.object({ accepted: z.boolean() });

export const quizRoom = (runId: string) => `quiz:${runId}`;
