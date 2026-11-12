import type { AiAskJob, AiAskRequest, AiJob, AiQuizJob, AiQuizRequest, AiStatus, StaffPrincipal } from '@ict/contracts';
import type { AuditLog } from '../../core/audit.js';
import { aiNotInstalled, notFound } from '../../core/errors.js';
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
  ) {}

  status(): AiStatus {
    const model = this.runtime.installed();
    return { installed: !!model, model: model?.name ?? null, ready: this.runtime.isReady(), queued: this.queue.queued() };
  }

  async requestQuiz(actor: StaffPrincipal, req: AiQuizRequest, wait = false): Promise<AiQuizJob> {
    const scope = scopeOf(actor);
    checkMyClass(this.classes, scope, req.classId);
    checkSubject(scope, req.subject);
    if (!this.runtime.installed()) throw aiNotInstalled();
    const job = this.queue.enqueue(actor.userId, 'quiz', req);
    this.audit.record({ kind: 'staff', id: actor.userId }, 'ai.quiz.request', job.id, { topic: req.topic });
    return wait ? ((await this.queue.waitFor(job.id, WAIT_MS)) as AiQuizJob) : job;
  }

  async requestAsk(actor: StaffPrincipal, req: AiAskRequest, wait = false): Promise<AiAskJob> {
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

  jobs(actor: StaffPrincipal): AiJob[] {
    return this.queue.listFor(actor.userId);
  }
}
