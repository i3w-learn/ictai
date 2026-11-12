import { describe, expect, it } from 'vitest';
import type { Llm, LlmRequest } from '../src/modules/ai/llm-client.js';
import { testServer } from './helpers.js';

// A model that answers any question by echoing it.
const echoLlm: Llm = {
  async json<T>(req: LlmRequest<T>) {
    return { answer: `You asked: ${req.user.split('\n').at(-1)}` } as T;
  },
};

async function setup(ai?: { llm: Llm; installed: boolean }) {
  const t = await testServer({ ai });
  const teacher = t.auth(await t.login('teacher', 'teacher-pass'));
  const admin = t.auth(await t.login('admin', 'admin-pass'));
  const inject = (method: 'GET' | 'POST', url: string, headers: object, payload?: object) =>
    t.app.inject({ method, url, headers: headers as Record<string, string>, ...(payload ? { payload } : {}) });
  const ask = (who: object, question = 'Why is the sky blue?') => inject('POST', '/api/v1/ai/ask', who, { question });
  return { ...t, teacher, admin, inject, ask };
}

describe('AI ask', () => {
  it('teacher asks a question and reads the answer on the job', async () => {
    const { ask, inject, teacher, c } = await setup({ llm: echoLlm, installed: true });
    const res = await ask(teacher);
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ kind: 'ask', status: 'queued', request: { question: 'Why is the sky blue?', language: 'en' } });
    await c.aiQueue.idle();
    const job = (await inject('GET', `/api/v1/ai/jobs/${res.json().id}`, teacher)).json();
    expect(job).toMatchObject({ kind: 'ask', status: 'done', result: { answer: 'You asked: Why is the sky blue?' } });
  });

  it('with wait=1 the answer comes back in the same call', async () => {
    const { inject, teacher } = await setup({ llm: echoLlm, installed: true });
    const res = await inject('POST', '/api/v1/ai/ask?wait=1', teacher, { question: 'What is 2 + 2?' });
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ kind: 'ask', status: 'done', result: { answer: 'You asked: What is 2 + 2?' } });
  });

  it('returns AI_NOT_INSTALLED without a model', async () => {
    const { ask, teacher } = await setup();
    const res = await ask(teacher);
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('AI_NOT_INSTALLED');
  });

  it('rejects an empty question', async () => {
    const { ask, teacher } = await setup({ llm: echoLlm, installed: true });
    expect((await ask(teacher, '   ')).statusCode).toBe(400);
  });

  it('records the request in the activity log', async () => {
    const { ask, inject, teacher, admin } = await setup({ llm: echoLlm, installed: true });
    await ask(teacher);
    const log = (await inject('GET', '/api/v1/audit', admin)).json();
    expect(log[0]).toMatchObject({ action: 'ai.ask.request', detail: { question: 'Why is the sky blue?' } });
  });

  it('a signed-in student cannot ask', async () => {
    const { inject, teacher, enrolDevice, auth } = await setup({ llm: echoLlm, installed: true });
    const c7 = (await inject('POST', '/api/v1/classes', teacher, { name: '7' })).json();
    const kid = (await inject('POST', '/api/v1/students', teacher, { name: 'Asha', classId: c7.id, pin: '1111' })).json();
    const device = auth(await enrolDevice('lab_pc'));
    const { token } = (await inject('POST', '/api/v1/auth/student/pin', device, { studentId: kid.id, pin: '1111' })).json();
    expect((await inject('POST', '/api/v1/ai/ask', auth(token), { question: 'Hi' })).statusCode).toBe(403);
  });
});
