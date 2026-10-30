import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import type { AiQuizRequest, AiQuizResult } from '@ict/contracts';
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

function setup(run: (r: AiQuizRequest, s: AbortSignal) => Promise<AiQuizResult>, timeoutMs = 60_000) {
  const db = openDb(':memory:');
  const clock = { t: 1_800_000_000_000 };
  const user = (name: string) => {
    const id = randomUUID();
    db.prepare(`INSERT INTO users (id, role, username, display_name, password_hash, status, created_at, updated_at)
                VALUES (?, 'teacher', ?, ?, 'x', 'active', 0, 0)`).run(id, name, name);
    return id;
  };
  const repo = new JobRepository(db);
  const queue = new JobQueue(() => clock.t, repo, run, timeoutMs);
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
  it('runs one job at a time in order', async () => {
    const m = manualRun();
    const { queue, user } = setup(m.run);
    queue.start();
    const a = queue.enqueue(user('a'), request);
    const b = queue.enqueue(user('b'), request);
    await new Promise((r) => setTimeout(r, 5));
    expect(queue.get(a.id)!.status).toBe('running');
    expect(queue.get(b.id)).toMatchObject({ status: 'queued', position: 1 });
    await m.next();
    await m.next();
    await queue.idle();
    expect(queue.get(a.id)).toMatchObject({ status: 'done', result, position: null });
    expect(queue.get(b.id)!.status).toBe('done');
  });

  it('one open job per user', () => {
    const { queue, user } = setup(manualRun().run);
    const u = user('a');
    queue.enqueue(u, request);
    expect(() => queue.enqueue(u, request)).toThrow(expect.objectContaining({ code: 'AI_BUSY', status: 409 }));
  });

  it('fails the job when the model call throws, then runs the next', async () => {
    let calls = 0;
    const { queue, user } = setup(async () => {
      if (calls++ === 0) throw new Error('boom');
      return result;
    });
    queue.start();
    const a = queue.enqueue(user('a'), request);
    const b = queue.enqueue(user('b'), request);
    await queue.idle();
    expect(queue.get(a.id)).toMatchObject({ status: 'failed', error: 'The AI stopped unexpectedly. Try again.' });
    expect(queue.get(b.id)!.status).toBe('done');
  });

  it('passes on the not-installed message', async () => {
    const { queue, user } = setup(async () => {
      throw new AppError(503, 'AI_NOT_INSTALLED', 'AI is not installed on this server.');
    });
    queue.start();
    const a = queue.enqueue(user('a'), request);
    await queue.idle();
    expect(queue.get(a.id)!.error).toBe('AI is not installed on this server.');
  });

  it('fails after the timeout', async () => {
    const { queue, user } = setup(() => new Promise(() => {}), 30);
    queue.start();
    const a = queue.enqueue(user('a'), request);
    await queue.idle();
    expect(queue.get(a.id)).toMatchObject({ status: 'failed', error: 'Making the quiz took too long. Try fewer questions.' });
  });

  it('marks running jobs failed on start', () => {
    const { db, repo, queue, user, clock } = setup(manualRun().run);
    const id = randomUUID();
    repo.insert(id, user('a'), request, clock.t);
    db.prepare(`UPDATE ai_jobs SET status = 'running' WHERE id = ?`).run(id);
    queue.start();
    expect(queue.get(id)).toMatchObject({ status: 'failed', error: 'The server restarted. Try again.' });
  });

  it('deletes jobs older than 90 days on start', () => {
    const { repo, queue, user, clock } = setup(manualRun().run);
    const old = randomUUID();
    repo.insert(old, user('a'), request, clock.t - 91 * 24 * 3600_000);
    queue.start();
    expect(queue.get(old)).toBeNull();
  });

  it('lists a user\'s jobs newest first', async () => {
    const { queue, user, clock } = setup(async () => result);
    queue.start();
    const u = user('a');
    const first = queue.enqueue(u, request);
    await queue.idle();
    clock.t += 1000;
    const second = queue.enqueue(u, request);
    await queue.idle();
    expect(queue.listFor(u).map((j) => j.id)).toEqual([second.id, first.id]);
  });
});
