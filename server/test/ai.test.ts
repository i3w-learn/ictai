import { describe, expect, it } from 'vitest';
import type { Llm, LlmRequest } from '../src/modules/ai/llm-client.js';
import { testServer } from './helpers.js';

// A model that always writes the same good English question and answers it right when asked again.
const goodLlm: Llm = {
  async json<T>(req: LlmRequest<T>) {
    if (req.user.startsWith('Write')) {
      const n = Number(/Write (\d+)/.exec(req.user)![1]);
      return { questions: Array.from({ length: n }, (_, i) => ({ text: `What is ${i} + 1?`, options: [`${i + 1}`, `${i + 2}`, `${i + 3}`, `${i + 4}`], correct: 0 })) } as T;
    }
    // Question i is shown rotated by (i % 3) + 1, so the right option (0) sits at 4 - shift.
    const n = (req.user.match(/^Question \d+:/gm) ?? []).length;
    return { answers: Array.from({ length: n }, (_, i) => (4 - ((i % 3) + 1)) % 4) } as T;
  },
};

async function setup(ai?: { llm: Llm; installed: boolean }) {
  const t = await testServer({ ai });
  const teacher = t.auth(await t.login('teacher', 'teacher-pass'));
  const admin = t.auth(await t.login('admin', 'admin-pass'));
  const inject = (method: 'GET' | 'POST', url: string, headers: object, payload?: object) =>
    t.app.inject({ method, url, headers: headers as Record<string, string>, ...(payload ? { payload } : {}) });
  const c7 = (await inject('POST', '/api/v1/classes', teacher, { name: '7' })).json();
  const ask = (who: object, count = 3) => inject('POST', '/api/v1/ai/quiz', who, { classId: c7.id, subject: 'Maths', topic: 'Adding', count });
  return { ...t, teacher, admin, inject, c7, ask };
}

describe('AI quiz maker', () => {
  it('status says not installed', async () => {
    const { inject, teacher } = await setup();
    const res = await inject('GET', '/api/v1/ai/status', teacher);
    expect(res.json()).toEqual({ installed: false, model: null, ready: false, queued: 0 });
  });

  it('request returns AI_NOT_INSTALLED without a model', async () => {
    const { ask, teacher } = await setup();
    const res = await ask(teacher);
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('AI_NOT_INSTALLED');
  });

  it('teacher gets a draft, not a saved quiz', async () => {
    const { ask, inject, teacher, c } = await setup({ llm: goodLlm, installed: true });
    const res = await ask(teacher, 3);
    expect(res.statusCode).toBe(202);
    expect(res.json().status).toBe('queued');
    await c.aiQueue.idle();
    const job = (await inject('GET', `/api/v1/ai/jobs/${res.json().id}`, teacher)).json();
    expect(job.status).toBe('done');
    expect(job.result.questions).toHaveLength(3);
    expect(job.result.flags.every((f: { ok: boolean }) => f.ok)).toBe(true);
    expect((await inject('GET', '/api/v1/quizzes', teacher)).json()).toEqual([]);
    expect((await inject('GET', '/api/v1/ai/jobs', teacher)).json().map((j: { id: string }) => j.id)).toEqual([job.id]);
  });

  it('with wait=1 the draft comes back in the same call', async () => {
    const { inject, teacher, c7 } = await setup({ llm: goodLlm, installed: true });
    const res = await inject('POST', '/api/v1/ai/quiz?wait=1', teacher, { classId: c7.id, subject: 'Maths', topic: 'Adding', count: 2 });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ kind: 'quiz', status: 'done' });
    expect(res.json().result.questions).toHaveLength(2);
  });

  it('records the request in the activity log', async () => {
    const { ask, inject, teacher, admin } = await setup({ llm: goodLlm, installed: true });
    await ask(teacher);
    const log = (await inject('GET', '/api/v1/audit', admin)).json();
    expect(log[0]).toMatchObject({ action: 'ai.quiz.request', detail: { topic: 'Adding' } });
  });

  it('refuses an unknown class', async () => {
    const { inject, teacher } = await setup({ llm: goodLlm, installed: true });
    const res = await inject('POST', '/api/v1/ai/quiz', teacher, { classId: '00000000-0000-4000-8000-000000000000', subject: 'Maths', topic: 'x' });
    expect(res.statusCode).toBe(404);
  });

  it("cannot read another user's job", async () => {
    const { ask, inject, teacher, admin } = await setup({ llm: goodLlm, installed: true });
    const job = (await ask(admin)).json();
    expect((await inject('GET', `/api/v1/ai/jobs/${job.id}`, teacher)).statusCode).toBe(404);
  });

  it('students cannot use AI', async () => {
    const { inject, teacher, c7, enrolDevice, auth } = await setup({ llm: goodLlm, installed: true });
    const kid = (await inject('POST', '/api/v1/students', teacher, { name: 'Asha', classId: c7.id, pin: '1111' })).json();
    const device = auth(await enrolDevice('lab_pc'));
    const { token } = (await inject('POST', '/api/v1/auth/student/pin', device, { studentId: kid.id, pin: '1111' })).json();
    expect((await inject('GET', '/api/v1/ai/status', auth(token))).statusCode).toBe(403);
  });
});
