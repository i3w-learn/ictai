import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AiAskRequest, AiAskResult, AiQuizRequest, AiQuizResult } from '@ict/contracts';
import { AppError } from '../src/core/errors.js';
import { openDb } from '../src/infra/db/index.js';
import { JobRepository } from '../src/modules/ai/job.repository.js';
import { JobQueue } from '../src/modules/ai/job-queue.js';

const request: AiQuizRequest = { classId: randomUUID(), subject: 'Maths', topic: 'Fractions', count: 1, language: 'en' };
const result: AiQuizResult = {
  questions: [{ text: 'Half of 4?', options: ['1', '2', '3', '4'], correct: 1, marks: 1 }],
  flags: [{ ok: true, note: null }],
  note: null,
};

function setup(
  run: (r: AiQuizRequest, s: AbortSignal) => Promise<AiQuizResult>,
  timeoutMs = 60_000,
  prepare?: () => Promise<void>,
  ask: (r: AiAskRequest, s: AbortSignal) => Promise<AiAskResult> = async () => ({ answer: '' }),
) {
  const db = openDb(':memory:');
  const clock = { t: 1_800_000_000_000 };
  const user = (name: string) => {
    const id = randomUUID();
    db.prepare(`INSERT INTO users (id, role, username, display_name, password_hash, status, created_at, updated_at)
                VALUES (?, 'teacher', ?, ?, 'x', 'active', 0, 0)`).run(id, name, name);
    return id;
  };
  const repo = new JobRepository(db);
  const queue = new JobQueue(() => clock.t, repo, { quiz: run, ask }, timeoutMs, prepare);
  return { db, clock, repo, queue, user };
}

// A run whose replies the test releases by hand.
function manualRun() {
  const pending: ((r: AiQuizResult) => void)[] = [];
  const run = () => new Promise<AiQuizResult>((resolve) => pending.push(resolve));
  const next = async () => {
    while (!pending.length) await new Promise((r) => setTimeout(r, 1));
    pending.shift()!(result);
  };
  return { run, next };
}

describe('AI job queue', () => {
  it('runs each job with the runner for its kind', async () => {
    const askRequest: AiAskRequest = { question: 'Why is the sky blue?', language: 'en' };
    const { queue, user } = setup(async () => result, 60_000, undefined, async (r) => ({ answer: `About: ${r.question}` }));
    queue.start();
    const a = queue.enqueue(user('a'), 'ask', askRequest);
    const b = queue.enqueue(user('b'), 'quiz', request);
    await queue.idle();
    expect(queue.get(a.id)).toMatchObject({ kind: 'ask', status: 'done', request: askRequest, result: { answer: 'About: Why is the sky blue?' } });
    expect(queue.get(b.id)).toMatchObject({ kind: 'quiz', status: 'done', result });
  });

  it('runs one job at a time in order', async () => {
    const m = manualRun();
    const { queue, user } = setup(m.run);
    queue.start();
    const a = queue.enqueue(user('a'), 'quiz', request);
    const b = queue.enqueue(user('b'), 'quiz', request);
    await new Promise((r) => setTimeout(r, 5));
    expect(queue.get(a.id)!.status).toBe('running');
    expect(queue.get(b.id)).toMatchObject({ status: 'queued', position: 1 });
    await m.next();
    await m.next();
    await queue.idle();
    expect(queue.get(a.id)).toMatchObject({ status: 'done', result, position: null });
    expect(queue.get(b.id)!.status).toBe('done');
  });

  it('waitFor resolves when the job finishes, or with the job as it is after the time limit', async () => {
    const m = manualRun();
    const { queue, user } = setup(m.run);
    queue.start();
    const a = queue.enqueue(user('a'), 'quiz', request);
    expect((await queue.waitFor(a.id, 20)).status).toBe('running');
    const done = queue.waitFor(a.id, 10_000);
    await m.next();
    expect((await done).status).toBe('done');
    expect((await queue.waitFor(a.id, 10_000)).status).toBe('done');
    // Nothing is kept for a job once nobody waits on it.
    expect((queue as unknown as { waiters: Map<string, unknown> }).waiters.size).toBe(0);
  });

  it('lets go of waiting callers when the server stops', async () => {
    const m = manualRun();
    const { queue, user } = setup(m.run);
    queue.start();
    const a = queue.enqueue(user('a'), 'quiz', request);
    const held = queue.waitFor(a.id, 60_000);
    queue.stop();
    // The caller gets the job as it stands (not finished) straight away, not after a minute.
    expect((await held).status).not.toBe('done');
    expect((queue as unknown as { waiters: Map<string, unknown> }).waiters.size).toBe(0);
  });

  it('one open job per user', () => {
    const { queue, user } = setup(manualRun().run);
    const u = user('a');
    queue.enqueue(u, 'quiz', request);
    expect(() => queue.enqueue(u, 'quiz', request)).toThrow(expect.objectContaining({ code: 'AI_BUSY', status: 409 }));
  });

  it('fails the job when the model call throws, then runs the next', async () => {
    let calls = 0;
    const { queue, user } = setup(async () => {
      if (calls++ === 0) throw new Error('boom');
      return result;
    });
    queue.start();
    const a = queue.enqueue(user('a'), 'quiz', request);
    const b = queue.enqueue(user('b'), 'quiz', request);
    await queue.idle();
    expect(queue.get(a.id)).toMatchObject({ status: 'failed', error: 'The AI stopped unexpectedly. Try again.' });
    expect(queue.get(b.id)!.status).toBe('done');
  });

  it('passes on the not-installed message', async () => {
    const { queue, user } = setup(async () => {
      throw new AppError(503, 'AI_NOT_INSTALLED', 'AI is not installed on this server.');
    });
    queue.start();
    const a = queue.enqueue(user('a'), 'quiz', request);
    await queue.idle();
    expect(queue.get(a.id)!.error).toBe('AI is not installed on this server.');
  });

  it('fails after the timeout', async () => {
    const { queue, user } = setup(() => new Promise(() => {}), 30);
    queue.start();
    const a = queue.enqueue(user('a'), 'quiz', request);
    await queue.idle();
    expect(queue.get(a.id)).toMatchObject({ status: 'failed', error: 'The AI took too long. Try a smaller request.' });
  });

  it('stop fails the running job as a restart and takes no more jobs', async () => {
    let reject: (e: Error) => void = () => {};
    const { queue, user } = setup(() => new Promise((_, r) => { reject = r; }));
    queue.start();
    const a = queue.enqueue(user('a'), 'quiz', request);
    const b = queue.enqueue(user('b'), 'quiz', request);
    await new Promise((r) => setTimeout(r, 5));
    queue.stop();
    reject(new Error('socket hang up'));
    await queue.idle();
    expect(queue.get(a.id)).toMatchObject({ status: 'failed', error: 'The server restarted. Try again.' });
    expect(queue.get(b.id)!.status).toBe('queued');
  });

  it('loading the model does not count against the time limit', async () => {
    let loaded = false;
    const { queue, user } = setup(async () => result, 30, () => new Promise((r) => setTimeout(() => { loaded = true; r(); }, 60)));
    queue.start();
    const a = queue.enqueue(user('a'), 'quiz', request);
    await queue.idle();
    expect(loaded).toBe(true);
    expect(queue.get(a.id)!.status).toBe('done');
  });

  it('marks running jobs failed on start', () => {
    const { db, repo, queue, user, clock } = setup(manualRun().run);
    const id = randomUUID();
    repo.insert(id, user('a'), 'quiz', request, clock.t);
    db.prepare(`UPDATE ai_jobs SET status = 'running' WHERE id = ?`).run(id);
    queue.start();
    expect(queue.get(id)).toMatchObject({ status: 'failed', error: 'The server restarted. Try again.' });
  });

  it('deletes jobs older than 90 days on start', () => {
    const { repo, queue, user, clock } = setup(manualRun().run);
    const old = randomUUID();
    repo.insert(old, user('a'), 'quiz', request, clock.t - 91 * 24 * 3600_000);
    queue.start();
    expect(queue.get(old)).toBeNull();
  });

  it('lists a user\'s jobs newest first', async () => {
    const { queue, user, clock } = setup(async () => result);
    queue.start();
    const u = user('a');
    const first = queue.enqueue(u, 'quiz', request);
    await queue.idle();
    clock.t += 1000;
    const second = queue.enqueue(u, 'quiz', request);
    await queue.idle();
    expect(queue.listFor(u).map((j) => j.id)).toEqual([second.id, first.id]);
  });
});
