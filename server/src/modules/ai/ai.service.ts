import { TUTOR_DAILY_CAP, TUTOR_QUEUE_MAX, type AiAskJob, type AiAskRequest, type AiJob, type AiJobKind, type AiQuizJob, type AiQuizRequest, type AiStatus, type AiTutorJob, type AiTutorRequest, type MyTutor, type StaffPrincipal, type StudentPrincipal } from '@ict/contracts';
import type { AuditLog } from '../../core/audit.js';
import type { Clock } from '../../core/clock.js';
import { AppError, aiNotInstalled, aiSwitchedOff, notFound } from '../../core/errors.js';
import { checkMyClass, checkSubject, scopeOf } from '../../core/scope.js';
import type { ClassRepository } from '../students/class.repository.js';
import type { JobQueue } from './job-queue.js';

// How long one HTTP call may hold the line for an answer; after that the caller gets the ticket and polls.
const WAIT_MS = 120_000;

// The part of the runtime the service needs: is a model there, and is it loaded.
export interface AiRuntimeInfo {
  installed(): { name: string } | null;
  isReady(): boolean;
}

// Spec 9 AI gateway for Part 1: permission is checked by the route, then the request waits in line.
export class AiService {
  constructor(
    private readonly runtime: AiRuntimeInfo,
    private readonly queue: JobQueue,
    private readonly classes: ClassRepository,
    private readonly audit: AuditLog,
    // The Super Admin's switch in Settings. Asked on every request, so a change works at once.
    private readonly enabled: () => boolean = () => true,
    private readonly now: Clock = Date.now,
  ) {}

  status(): AiStatus {
    const model = this.runtime.installed();
    return { enabled: this.enabled(), installed: !!model, model: model?.name ?? null, ready: this.runtime.isReady(), queued: this.queue.queued() };
  }

  async requestQuiz(actor: StaffPrincipal, req: AiQuizRequest, wait = false): Promise<AiQuizJob> {
    const scope = scopeOf(actor);
    checkMyClass(this.classes, scope, req.classId);
    checkSubject(scope, req.subject);
    if (!this.enabled()) throw aiSwitchedOff();
    if (!this.runtime.installed()) throw aiNotInstalled();
    const job = this.queue.enqueue(actor.userId, 'quiz', req);
    this.audit.record({ kind: 'staff', id: actor.userId }, 'ai.quiz.request', job.id, { topic: req.topic });
    return wait ? ((await this.queue.waitFor(job.id, WAIT_MS)) as AiQuizJob) : job;
  }

  async requestAsk(actor: StaffPrincipal, req: AiAskRequest, wait = false): Promise<AiAskJob> {
    if (!this.enabled()) throw aiSwitchedOff();
    if (!this.runtime.installed()) throw aiNotInstalled();
    const job = this.queue.enqueue(actor.userId, 'ask', req);
    this.audit.record({ kind: 'staff', id: actor.userId }, 'ai.ask.request', job.id, { question: req.question });
    return wait ? ((await this.queue.waitFor(job.id, WAIT_MS)) as AiAskJob) : job;
  }

  // Someone else's request looks the same as one that doesn't exist.
  job(actor: StaffPrincipal, id: string): AiJob {
    const job = this.queue.ownerOf(id) === actor.userId ? this.queue.get(id) : null;
    if (!job) throw notFound('AI request');
    return job;
  }

  jobs(actor: StaffPrincipal, kind?: AiJobKind): AiJob[] {
    return kind ? this.queue.listKindFor(actor.userId, kind) : this.queue.listFor(actor.userId);
  }

  // --- The student tutor (PRD student app "Ask") ---

  // A student may ask a fixed number of questions each day; the count starts again at midnight on the server's clock.
  myTutor(me: StudentPrincipal): MyTutor {
    const used = this.queue.countSince(me.studentId, 'tutor', startOfDay(this.now()));
    return { leftToday: Math.max(0, TUTOR_DAILY_CAP - used), dailyCap: TUTOR_DAILY_CAP, jobs: (this.queue.listKindFor(me.studentId, 'tutor') as AiTutorJob[]).map(publicTutor) };
  }

  requestTutor(me: StudentPrincipal, req: AiTutorRequest): AiTutorJob {
    if (!this.enabled()) throw aiSwitchedOff();
    if (!this.runtime.installed()) throw aiNotInstalled();
    if (this.queue.countSince(me.studentId, 'tutor', startOfDay(this.now())) >= TUTOR_DAILY_CAP) {
      throw new AppError(429, 'DAILY_CAP', `You have asked ${TUTOR_DAILY_CAP} questions today. You can ask more tomorrow.`);
    }
    if (this.queue.queuedOf('tutor') >= TUTOR_QUEUE_MAX) {
      throw new AppError(429, 'TUTOR_BUSY', 'The helper is busy with other questions right now. Try again in a few minutes.');
    }
    // The class comes from who is signed in, so the tutor pitches its words for that class.
    const job = this.queue.enqueue(me.studentId, 'tutor', { ...req, className: this.classes.name(me.classId) ?? null } as AiTutorRequest);
    // The question itself is not written to the activity log: it is the student's own.
    this.audit.record({ kind: 'student', id: me.studentId }, 'ai.tutor.request', job.id, {});
    return publicTutor(job);
  }

  // Someone else's question looks the same as one that does not exist.
  tutorJob(me: StudentPrincipal, id: string): AiTutorJob {
    const job = this.queue.ownerOf(id) === me.studentId ? this.queue.get(id) : null;
    if (!job || job.kind !== 'tutor') throw notFound('Question');
    return publicTutor(job);
  }
}

const startOfDay = (now: number) => new Date(now).setHours(0, 0, 0, 0);
// The stored request also carries the class name for the prompt; the student is sent back only their question.
const publicTutor = (job: AiTutorJob): AiTutorJob => ({ ...job, request: { question: job.request.question } });
