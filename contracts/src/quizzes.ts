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
  // The run that is open now (Lab Mode or practice), so the list can say so and lead back to it.
  open: z.object({ runId: z.string(), mode: z.enum(['live', 'practice']) }).nullable(),
  // The newest practice that has ended: where a teacher finds its tries and best scores again.
  lastPracticeRunId: z.string().nullable(),
});
export type QuizSummary = z.infer<typeof QuizSummary>;

export const QuizQuery = z.object({ classId: Id.optional() });

// Lab Mode: a run of one quiz. lobby → active → ended.
export const RunStatus = z.enum(['lobby', 'active', 'ended']);
export type RunStatus = z.infer<typeof RunStatus>;

// live: Lab Mode, everyone together on a clock. practice: given to a class to do at their own speed,
// with no clock and as many tries as they like. Practice scores are not used for results or report cards.
export const RunMode = z.enum(['live', 'practice']);
export type RunMode = z.infer<typeof RunMode>;

// How a team is doing. `score` is the average of its members' scores (one decimal), so a team with
// one more student gets no head start.
export const TeamStanding = z.object({ team: z.number(), members: z.number(), score: z.number() });
export type TeamStanding = z.infer<typeof TeamStanding>;

export const RunParticipant = z.object({
  studentId: z.string(),
  name: z.string(),
  rollNo: z.string().nullable(),
  answered: z.number(),
  correct: z.number(),
  score: z.number(),
  finished: z.boolean(),
  // Their team (1, 2, ...) in a live quiz played in teams; null otherwise.
  team: z.number().nullable(),
  // Practice: how many tries they have started, and the best score of the tries they finished.
  tries: z.number(),
  best: z.number().nullable(),
});
export type RunParticipant = z.infer<typeof RunParticipant>;

// What the teacher sees. Participants are sorted by score, highest first (practice: by best score).
// `teams` is empty unless the quiz is played in teams; best team first.
export const TeacherRunState = z.object({
  kind: z.literal('teacher'),
  runId: z.string(),
  quizId: z.string(),
  title: z.string(),
  className: z.string(),
  mode: RunMode,
  status: RunStatus,
  questionCount: z.number(),
  totalMarks: z.number(),
  participants: z.array(RunParticipant),
  teams: z.array(TeamStanding),
});
export type TeacherRunState = z.infer<typeof TeacherRunState>;

// Stored and shown in place of a choice when a question's time ran out with no answer.
export const TIMED_OUT = -1;

// What a student sees. Never includes the correct answers.
// The server keeps each question's clock: `current` says which question the student is on and
// how long is left, so reloading the page cannot win time back. It is null when there is nothing
// to answer (lobby, ended, handed in, or every question done). `myAnswers` holds the chosen
// option, TIMED_OUT, or null for a question not reached yet.
// In practice there is no clock: `remainingMs` is null.
// `team` is the student's own team; `teams` (every team's place) comes once the student is done.
export const StudentRunState = z.object({
  kind: z.literal('student'),
  runId: z.string(),
  title: z.string(),
  mode: RunMode,
  status: RunStatus,
  secondsPerQuestion: z.number(),
  questions: z.array(z.object({ text: z.string(), options: z.array(z.string()) })),
  myAnswers: z.array(z.number().nullable()),
  current: z.object({ index: z.number(), remainingMs: z.number().nullable() }).nullable(),
  finished: z.boolean(),
  score: z.number().nullable(),
  totalMarks: z.number(),
  team: z.number().nullable(),
  teams: z.array(TeamStanding).nullable(),
  tries: z.number(),
  best: z.number().nullable(),
});
export type StudentRunState = z.infer<typeof StudentRunState>;

export const RunSummary = z.object({
  id: z.string(),
  quizId: z.string(),
  title: z.string(),
  mode: RunMode,
  status: RunStatus,
  createdAt: z.number(),
  participants: z.number(),
});
export type RunSummary = z.infer<typeof RunSummary>;

export const TEAM_COUNTS = [2, 3, 4] as const;
// teams: 0 = everyone for themselves. Teams are for a live quiz only.
export const OpenRun = z
  .object({
    quizId: Id,
    mode: RunMode.default('live'),
    teams: z.union([z.literal(0), z.literal(2), z.literal(3), z.literal(4)]).default(0),
  })
  .refine((o) => o.mode === 'live' || o.teams === 0, { message: 'Teams are for a live quiz, not for practice', path: ['teams'] });
export type OpenRun = z.infer<typeof OpenRun>;
// A practice quiz given to the student's class. tries: how many they have started; best: the best
// score of the tries they finished; finished: nothing is half done, so "Try again" can be offered.
export const PracticeForStudent = z.object({
  runId: z.string(),
  title: z.string(),
  questionCount: z.number(),
  totalMarks: z.number(),
  tries: z.number(),
  best: z.number().nullable(),
  finished: z.boolean(),
});
export type PracticeForStudent = z.infer<typeof PracticeForStudent>;
export const RunQuery = z.object({ quizId: Id });
// A quiz the teacher has opened for the student's class, which the student has not handed in yet.
// The student's screen shows it by itself; there is no code to type.
export const OpenRunForStudent = z.object({ runId: z.string(), title: z.string(), status: RunStatus });
export type OpenRunForStudent = z.infer<typeof OpenRunForStudent>;
export const SubmitAnswer = z.object({ questionIndex: z.number().int().min(0), choice: z.number().int().min(0) });
export const AnswerResult = z.object({ accepted: z.boolean() });

export const quizRoom = (runId: string) => `quiz:${runId}`;
