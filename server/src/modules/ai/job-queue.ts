import { randomUUID } from 'node:crypto';
import type { AiJob, AiJobKind, AiJobOf, AiRequestOf, AiResultOf } from '@ict/contracts';
import { DAY, type Clock } from '../../core/clock.js';
import { AppError } from '../../core/errors.js';
import type { JobRepository } from './job.repository.js';

export type JobRunner<K extends AiJobKind> = (request: AiRequestOf<K>, signal: AbortSignal) => Promise<AiResultOf<K>>;
// One runner per kind of job. A new kind means a new runner here; the queue itself does not change.
export type JobRunners = { [K in AiJobKind]: JobRunner<K> };

// A tutor answer is short (a hint of about 120 words), so it gets a much shorter time limit than a quiz.
// One stuck question then holds the line for minutes, not a quarter of an hour.
const TUTOR_TIMEOUT_MS = 3 * 60_000;

const TIMED_OUT = 'The AI took too long. Try a smaller request.';
const CRASHED = 'The AI stopped unexpectedly. Try again.';
const RESTARTED = 'The server restarted. Try again.';

// Spec 9: one AI job at a time across the server, one open request per user, kept 90 days.
// Accuracy over speed, so a job may take up to 15 minutes (spec's 120 s changed with the user).
export class JobQueue {
  private loop: Promise<void> | null = null;
  private stopping = false;
  // Callers holding an HTTP request open for a job's result; woken when that job finishes.
  private waiters = new Map<string, (() => void)[]>();

  constructor(
    private readonly now: Clock,
    private readonly repo: JobRepository,
    private readonly runners: JobRunners,
    private readonly timeoutMs = 15 * 60_000,
    // Loads the model; runs before the time limit starts, since a 33 GB model can take minutes to load.
    private readonly prepare: () => Promise<void> = async () => {},
  ) {}

  start() {
    this.repo.failRunning(RESTARTED, this.now());
    this.repo.purgeBefore(this.now() - 90 * DAY);
    this.kick();
  }

  enqueue<K extends AiJobKind>(userId: string, kind: K, request: AiRequestOf<K>): AiJobOf<K> {
    if (this.repo.hasOpen(userId)) {
      throw new AppError(409, 'AI_BUSY', 'You already have an AI request in progress. Wait for it to finish.');
    }
    const id = randomUUID();
    this.repo.insert(id, userId, kind, request, this.now());
    const job = this.repo.get(id) as AiJobOf<K>; // just inserted with this kind
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

  countSince(ownerId: string, kind: AiJobKind, since: number) {
    return this.repo.countSince(ownerId, kind, since);
  }

  listKindFor(ownerId: string, kind: AiJobKind, limit = 10) {
    return this.repo.listKindFor(ownerId, kind, limit);
  }

  queued() {
    return this.repo.queuedCount();
  }

  queuedOf(kind: AiJobKind) {
    return this.repo.queuedCountOf(kind);
  }

  // Resolves with the job once it is done or failed, or as it stands when maxMs runs out.
  waitFor(id: string, maxMs: number): Promise<AiJob> {
    const job = this.repo.get(id);
    if (!job || job.status === 'done' || job.status === 'failed') return Promise.resolve(job!);
    return new Promise((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        // Drop the empty list too, or one entry per job would pile up for as long as the server runs.
        const left = (this.waiters.get(id) ?? []).filter((w) => w !== finish);
        if (left.length > 0) this.waiters.set(id, left);
        else this.waiters.delete(id);
        resolve(this.repo.get(id)!);
      };
      const timer = setTimeout(finish, maxMs);
      this.waiters.set(id, [...(this.waiters.get(id) ?? []), finish]);
    });
  }

  // Shutdown: the running job ends as "restarted" and nothing new starts; queued jobs wait for the next boot.
  // Callers still holding a request open get the job as it stands, so shutdown does not hang on them.
  stop() {
    this.stopping = true;
    [...this.waiters.values()].flat().forEach((wake) => wake());
  }

  // Resolves once nothing is running (used by tests and shutdown).
  async idle() {
    while (this.loop) await this.loop;
  }

  // A job queued just as the loop is finishing would be missed, so the loop checks once more on the way out.
  private kick() {
    this.loop ??= this.drain().finally(() => {
      this.loop = null;
      if (!this.stopping && this.repo.nextQueued()) this.kick();
    });
  }

  private async drain() {
    for (let job = this.repo.nextQueued(); job && !this.stopping; job = this.repo.nextQueued()) {
      this.repo.markRunning(job.id, this.now());
      try {
        await this.prepare();
        this.repo.markDone(job.id, await this.withTimeout(job), this.now());
      } catch (err) {
        this.repo.markFailed(job.id, this.reason(err), this.now());
      }
      this.waiters.get(job.id)?.slice().forEach((wake) => wake());
    }
  }

  // The runner gets the signal; the race makes sure a runner that ignores it still stops.
  private withTimeout(job: AiJob) {
    const ctl = new AbortController();
    let timer: NodeJS.Timeout | undefined;
    const timedOut = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        ctl.abort();
        reject(new Error(TIMED_OUT));
      }, job.kind === 'tutor' ? Math.min(this.timeoutMs, TUTOR_TIMEOUT_MS) : this.timeoutMs);
    });
    return Promise.race([this.runFor(job, ctl.signal), timedOut]).finally(() => clearTimeout(timer));
  }

  // The job's kind picks its runner. TypeScript cannot pair a union's kind with its request on its own, hence the cast.
  private runFor(job: AiJob, signal: AbortSignal) {
    const run = this.runners[job.kind] as JobRunner<AiJobKind>;
    return run(job.request, signal);
  }

  private reason(err: unknown) {
    if (this.stopping) return RESTARTED;
    if (err instanceof AppError) return err.message;
    if (err instanceof Error && err.message === TIMED_OUT) return TIMED_OUT;
    return CRASHED;
  }
}
