import { randomUUID } from 'node:crypto';
import {
  quizRoom, type Quiz, type RunSummary, type StaffPrincipal, type StudentPrincipal,
  type StudentRunState, type TeacherRunState,
} from '@ict/contracts';
import type { AuditLog } from '../../core/audit.js';
import type { Clock } from '../../core/clock.js';
import { AppError, forbidden, lockedOut, notFound } from '../../core/errors.js';
import { asStudent } from '../../core/route.js';
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
        if (p.kind === 'staff') return true;
        return p.kind === 'student' && !!this.runs.participant(id, p.studentId);
      },
      snapshot: (p, id) => (p.kind === 'staff' ? this.teacherState(id) : this.studentState(id, asStudent(p))),
    });
  }

  open(actor: StaffPrincipal, quizId: string): TeacherRunState {
    const quiz = this.quizzes.get(quizId);
    if (!quiz) throw notFound('Quiz');
    if (this.runs.hasOpenRun(quizId)) throw new AppError(409, 'QUIZ_RUNNING', 'This quiz is already open in Lab Mode.');
    const id = randomUUID();
    this.runs.insert({ id, quizId, classId: quiz.classId, joinCode: this.freeCode(), openedBy: actor.userId, now: this.now() });
    this.audit.record({ kind: 'staff', id: actor.userId }, 'quiz.open', id, { quizId });
    return this.teacherState(id);
  }

  list(quizId: string): RunSummary[] {
    const quiz = this.quizzes.get(quizId);
    if (!quiz) throw notFound('Quiz');
    return this.runs.listByQuiz(quizId).map((r) => ({ ...r, title: quiz.title }));
  }

  start(actor: StaffPrincipal, id: string): TeacherRunState {
    const run = this.run(id);
    if (run.status !== 'lobby') throw new AppError(409, 'NOT_LOBBY', run.status === 'active' ? 'The quiz has already started.' : 'The quiz has ended.');
    this.runs.start(id, this.now());
    this.audit.record({ kind: 'staff', id: actor.userId }, 'quiz.start', id);
    this.relay.notify(quizRoom(id));
    return this.teacherState(id);
  }

  end(actor: StaffPrincipal, id: string): TeacherRunState {
    this.run(id);
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

  play(student: StudentPrincipal, id: string): StudentRunState {
    this.member(student, id);
    return this.studentState(id, student);
  }

  answer(student: StudentPrincipal, id: string, questionIndex: number, choice: number): { accepted: boolean } {
    const run = this.run(id);
    const me = this.member(student, id);
    if (run.status !== 'active') throw notActive(run.status);
    if (me.finished_at != null) throw new AppError(409, 'FINISHED', 'You have already finished this quiz.');
    const q = this.quiz(run).questions[questionIndex];
    if (!q || choice >= q.options.length) throw new AppError(400, 'BAD_REQUEST', 'No such question or option.');
    const fresh = this.runs.answer({
      runId: id, studentId: student.studentId, questionIndex, choice, points: choice === q.correct ? q.marks : 0, now: this.now(),
    });
    if (fresh) this.relay.notify(quizRoom(id));
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

  teacherState(id: string): TeacherRunState {
    const run = this.run(id);
    const quiz = this.quiz(run);
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
      finished: me?.finished_at != null,
      score: done ? mine.reduce((n, a) => n + a.points, 0) : null,
      totalMarks: quiz.totalMarks,
    };
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
