import { randomUUID } from 'node:crypto';
import {
  quizRoom, TIMED_OUT, type Quiz, type RunSummary, type StaffPrincipal, type StudentPrincipal,
  type StudentRunState, type TeacherRunState,
} from '@ict/contracts';
import type { AuditLog } from '../../core/audit.js';
import type { Clock } from '../../core/clock.js';
import { AppError, forbidden, lockedOut, notFound } from '../../core/errors.js';
import { asStudent } from '../../core/route.js';
import { checkQuiz, scopeOf, seesQuiz, type Scope } from '../../core/scope.js';
import type { Relay } from '../../relay/relay.js';
import type { FailureLimiter } from '../auth/limiter.js';
import { sixDigitCode } from '../auth/secrets.js';
import type { ClassRepository } from '../students/class.repository.js';
import type { QuizRepository } from './quiz.repository.js';
import type { RunRepository, RunRow } from './run.repository.js';

const notActive = (status: RunRow['status']) =>
  new AppError(409, 'NOT_ACTIVE', status === 'lobby' ? 'The quiz has not started yet.' : 'The quiz has ended.');

// Lab Mode (v2 parity): open with a code, students join, teacher starts, each student answers
// at their own pace, teacher ends. Every change pushes fresh state to the run's relay room.
// Each student works through the questions in order, and the server keeps the clock for each one.

// Where a student is in an active run: the question they are on and when its time ends.
interface Place {
  at: { index: number; deadline: number } | null;
  timedOut: number; // questions that ran out of time during this look
}
export class RunService {
  constructor(
    private readonly now: Clock,
    private readonly runs: RunRepository,
    private readonly quizzes: QuizRepository,
    private readonly classes: ClassRepository,
    private readonly relay: Relay,
    private readonly limiter: FailureLimiter,
    private readonly audit: AuditLog,
  ) {
    relay.register({
      prefix: 'quiz',
      canJoin: (p, id) => {
        const run = this.runs.get(id);
        if (!run) return false;
        if (p.kind === 'staff') return seesQuiz(scopeOf(p), this.quiz(run));
        return p.kind === 'student' && !!this.runs.participant(id, p.studentId);
      },
      snapshot: (p, id) => (p.kind === 'staff' ? this.teacherState(id) : this.studentState(id, asStudent(p))),
    });
  }

  open(actor: StaffPrincipal, quizId: string): TeacherRunState {
    const quiz = this.quizzes.get(quizId);
    if (!quiz) throw notFound('Quiz');
    checkQuiz(scopeOf(actor), quiz);
    if (this.runs.hasOpenRun(quizId)) throw new AppError(409, 'QUIZ_RUNNING', 'This quiz is already open in Lab Mode.');
    const id = randomUUID();
    this.runs.insert({ id, quizId, classId: quiz.classId, joinCode: this.freeCode(), openedBy: actor.userId, now: this.now() });
    this.audit.record({ kind: 'staff', id: actor.userId }, 'quiz.open', id, { quizId });
    return this.teacherState(id);
  }

  list(scope: Scope, quizId: string): RunSummary[] {
    const quiz = this.quizzes.get(quizId);
    if (!quiz) throw notFound('Quiz');
    checkQuiz(scope, quiz);
    return this.runs.listByQuiz(quizId).map((r) => ({ ...r, title: quiz.title }));
  }

  start(actor: StaffPrincipal, id: string): TeacherRunState {
    const run = this.mine(scopeOf(actor), id);
    if (run.status !== 'lobby') throw new AppError(409, 'NOT_LOBBY', run.status === 'active' ? 'The quiz has already started.' : 'The quiz has ended.');
    this.runs.start(id, this.now(), this.quiz(run).totalMarks);
    this.audit.record({ kind: 'staff', id: actor.userId }, 'quiz.start', id);
    this.relay.notify(quizRoom(id));
    return this.teacherState(id);
  }

  end(actor: StaffPrincipal, id: string): TeacherRunState {
    this.mine(scopeOf(actor), id);
    this.runs.end(id, this.now());
    this.audit.record({ kind: 'staff', id: actor.userId }, 'quiz.end', id);
    this.relay.notify(quizRoom(id));
    return this.teacherState(id);
  }

  join(student: StudentPrincipal, code: string): StudentRunState {
    const key = `quiz-join:${student.deviceId}`;
    const wait = this.limiter.blockedFor(key);
    if (wait > 0) throw lockedOut(wait);
    const run = this.runs.findOpenByCode(code);
    if (!run) {
      this.limiter.fail(key);
      throw new AppError(404, 'NOT_FOUND', 'No quiz is open with that code. Check the code on the board.');
    }
    this.limiter.succeed(key);
    if (run.class_id !== student.classId) {
      throw forbidden(`This quiz is for Class ${this.classes.name(run.class_id) ?? '?'}. Ask your teacher.`);
    }
    this.runs.addParticipant(run.id, student.studentId, student.deviceId, this.now());
    this.relay.notify(quizRoom(run.id));
    return this.studentState(run.id, student);
  }

  // The student's PC asks this when its countdown reaches zero. If a question did run out,
  // the teacher's screen is told too.
  play(student: StudentPrincipal, id: string): StudentRunState {
    this.member(student, id);
    const run = this.run(id);
    if (this.place(run, this.quiz(run), student.studentId).timedOut) this.relay.notify(quizRoom(id));
    return this.studentState(id, student);
  }

  answer(student: StudentPrincipal, id: string, questionIndex: number, choice: number): { accepted: boolean } {
    const run = this.run(id);
    const me = this.member(student, id);
    if (run.status !== 'active') throw notActive(run.status);
    if (me.finished_at != null) throw new AppError(409, 'FINISHED', 'You have already finished this quiz.');
    const quiz = this.quiz(run);
    const q = quiz.questions[questionIndex];
    if (!q || choice >= q.options.length) throw new AppError(400, 'BAD_REQUEST', 'No such question or option.');

    const { at, timedOut } = this.place(run, quiz, student.studentId);
    if (timedOut) this.relay.notify(quizRoom(id));
    const given = this.runs.answers(id, student.studentId).find((a) => a.question_index === questionIndex);
    if (given) {
      if (given.choice === TIMED_OUT) throw new AppError(409, 'TIME_UP', 'Time ran out for this question.');
      return { accepted: true }; // a resend: the first answer stands
    }
    if (at?.index !== questionIndex) throw new AppError(409, 'NOT_YOUR_QUESTION', 'Answer the question on your screen first.');
    this.runs.answer({
      runId: id, studentId: student.studentId, questionIndex, choice, points: choice === q.correct ? q.marks : 0, now: this.now(),
    });
    this.relay.notify(quizRoom(id));
    return { accepted: true };
  }

  finish(student: StudentPrincipal, id: string): StudentRunState {
    const run = this.run(id);
    this.member(student, id);
    if (run.status === 'lobby') throw notActive(run.status);
    this.runs.finish(id, student.studentId, this.now());
    this.relay.notify(quizRoom(id));
    return this.studentState(id, student);
  }

  // The teacher's live view, only for runs of their own classes and subjects.
  view(scope: Scope, id: string): TeacherRunState {
    this.mine(scope, id);
    return this.teacherState(id);
  }

  teacherState(id: string): TeacherRunState {
    const run = this.run(id);
    const quiz = this.quiz(run);
    // Bring every student's clock up to date first, so one who walked away still shows correctly.
    if (run.status === 'active') for (const studentId of this.runs.unfinishedIds(id)) this.place(run, quiz, studentId);
    return {
      kind: 'teacher',
      runId: run.id,
      quizId: quiz.id,
      title: quiz.title,
      className: this.classes.name(run.class_id) ?? '',
      joinCode: run.status === 'ended' ? null : run.join_code,
      status: run.status,
      questionCount: quiz.questions.length,
      totalMarks: quiz.totalMarks,
      participants: this.runs.participants(id),
    };
  }

  // Correct answers never leave the server; the score shows once the student is done.
  studentState(id: string, student: StudentPrincipal): StudentRunState {
    const run = this.run(id);
    const quiz = this.quiz(run);
    const me = this.runs.participant(id, student.studentId);
    const { at } = this.place(run, quiz, student.studentId);
    const mine = this.runs.answers(id, student.studentId);
    const myAnswers: (number | null)[] = quiz.questions.map(() => null);
    for (const a of mine) myAnswers[a.question_index] = a.choice;
    const done = me?.finished_at != null || run.status === 'ended';
    return {
      kind: 'student',
      runId: run.id,
      title: quiz.title,
      status: run.status,
      secondsPerQuestion: quiz.secondsPerQuestion,
      questions: quiz.questions.map((q) => ({ text: q.text, options: q.options })),
      myAnswers,
      current: at && { index: at.index, remainingMs: at.deadline - this.now() },
      finished: me?.finished_at != null,
      score: done ? mine.reduce((n, a) => n + a.points, 0) : null,
      totalMarks: quiz.totalMarks,
    };
  }

  // Works out which question a student is on. The first question's clock starts when the quiz
  // starts (or when a late joiner joins); each later one starts when the one before was answered
  // or ran out. Any question whose time has passed is written down as TIMED_OUT, so a reload,
  // or coming back after walking away, never gets the time back.
  private place(run: RunRow, quiz: Quiz, studentId: string): Place {
    const none: Place = { at: null, timedOut: 0 };
    if (run.status !== 'active' || run.started_at == null) return none;
    const me = this.runs.participant(run.id, studentId);
    if (!me || me.finished_at != null) return none;

    const rows = this.runs.answers(run.id, studentId);
    const done = new Set(rows.map((r) => r.question_index));
    const perQuestion = quiz.secondsPerQuestion * 1000;
    const now = this.now();
    let start = Math.max(run.started_at, me.joined_at, ...rows.map((r) => r.answered_at));
    let timedOut = 0;
    for (let index = 0; index < quiz.questions.length; index++) {
      if (done.has(index)) continue;
      const deadline = start + perQuestion;
      if (now < deadline) return { at: { index, deadline }, timedOut };
      this.runs.answer({ runId: run.id, studentId, questionIndex: index, choice: TIMED_OUT, points: 0, now: deadline });
      timedOut += 1;
      start = deadline;
    }
    return { at: null, timedOut };
  }

  private run(id: string): RunRow {
    const run = this.runs.get(id);
    if (!run) throw notFound('Quiz run');
    return run;
  }

  // A deleted quiz can't have an open run, but an ended run still shows its questions.
  private quiz(run: RunRow): Quiz {
    const quiz = this.quizzes.get(run.quiz_id, { includeDeleted: true });
    if (!quiz) throw notFound('Quiz');
    return quiz;
  }

  private mine(scope: Scope, id: string): RunRow {
    const run = this.run(id);
    checkQuiz(scope, this.quiz(run));
    return run;
  }

  private member(student: StudentPrincipal, id: string) {
    const me = this.runs.participant(id, student.studentId);
    if (!me) throw forbidden('Join the quiz with its code first.');
    return me;
  }

  private freeCode(): string {
    for (let tries = 0; tries < 20; tries++) {
      const code = sixDigitCode();
      if (!this.runs.findOpenByCode(code)) return code;
    }
    throw new AppError(503, 'BUSY', 'Could not make a free code. Try again.');
  }
}
