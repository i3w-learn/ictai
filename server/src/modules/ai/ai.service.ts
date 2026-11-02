import type { AiJob, AiQuizRequest, AiStatus, StaffPrincipal } from '@ict/contracts';
import type { AuditLog } from '../../core/audit.js';
import { aiNotInstalled, notFound } from '../../core/errors.js';
import type { ClassRepository } from '../students/class.repository.js';
import type { JobQueue } from './job-queue.js';

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

  requestQuiz(actor: StaffPrincipal, req: AiQuizRequest): AiJob {
    if (!this.runtime.installed()) throw aiNotInstalled();
    if (!this.classes.classExists(req.classId)) throw notFound('Class');
    const job = this.queue.enqueue(actor.userId, req);
    this.audit.record({ kind: 'staff', id: actor.userId }, 'ai.quiz.request', job.id, { topic: req.topic });
    return job;
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
