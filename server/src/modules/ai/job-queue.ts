import { randomUUID } from 'node:crypto';
import type { AiJob, AiQuizRequest, AiQuizResult } from '@ict/contracts';
import { DAY, type Clock } from '../../core/clock.js';
import { AppError } from '../../core/errors.js';
import type { JobRepository } from './job.repository.js';

export type JobRunner = (request: AiQuizRequest, signal: AbortSignal) => Promise<AiQuizResult>;

const TIMED_OUT = 'Making the quiz took too long. Try fewer questions.';
const CRASHED = 'The AI stopped unexpectedly. Try again.';

// Spec 9: one AI job at a time across the server, one open request per user, kept 90 days.
// Accuracy over speed, so a job may take up to 15 minutes (spec's 120 s changed with the user).
export class JobQueue {
  private loop: Promise<void> | null = null;

  constructor(
    private readonly now: Clock,
    private readonly repo: JobRepository,
    private readonly run: JobRunner,
    private readonly timeoutMs = 15 * 60_000,
  ) {}

  start() {
    this.repo.failRunning('The server restarted. Try again.', this.now());
    this.repo.purgeBefore(this.now() - 90 * DAY);
    this.kick();
  }

  enqueue(userId: string, request: AiQuizRequest): AiJob {
    if (this.repo.hasOpen(userId)) {
      throw new AppError(409, 'AI_BUSY', 'You already have a quiz being made. Wait for it to finish.');
    }
    const id = randomUUID();
    this.repo.insert(id, userId, request, this.now());
    const job = this.repo.get(id)!;
    this.kick();
    return job;
  }

  get(id: string) {
    return this.repo.get(id);
  }

  ownerOf(id: string) {
    return this.repo.ownerOf(id);
  }

  listFor(userId: string, limit = 10) {
    return this.repo.listFor(userId, limit);
  }

  queued() {
    return this.repo.queuedCount();
  }

  // Resolves once nothing is running (used by tests and shutdown).
  async idle() {
    while (this.loop) await this.loop;
  }

  // A job queued just as the loop is finishing would be missed, so the loop checks once more on the way out.
  private kick() {
    this.loop ??= this.drain().finally(() => {
      this.loop = null;
      if (this.repo.nextQueued()) this.kick();
    });
  }

  private async drain() {
    for (let job = this.repo.nextQueued(); job; job = this.repo.nextQueued()) {
      this.repo.markRunning(job.id, this.now());
      try {
        this.repo.markDone(job.id, await this.withTimeout(job.request), this.now());
      } catch (err) {
        this.repo.markFailed(job.id, this.reason(err), this.now());
      }
    }
  }

  // The runner gets the signal; the race makes sure a runner that ignores it still stops.
  private withTimeout(request: AiQuizRequest) {
    const ctl = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        ctl.abort();
        reject(new Error(TIMED_OUT));
      }, this.timeoutMs);
    });
    return Promise.race([this.run(request, ctl.signal), timedOut]).finally(() => clearTimeout(timer));
  }

  private reason(err: unknown) {
    if (err instanceof AppError) return err.message;
    if (err instanceof Error && err.message === TIMED_OUT) return TIMED_OUT;
    return CRASHED;
  }
}
