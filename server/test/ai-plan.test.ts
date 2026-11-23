import { describe, expect, it } from 'vitest';
import { CHUNK_BYTES } from '@ict/contracts';
import type { Llm, LlmRequest } from '../src/modules/ai/llm-client.js';
import { fitMinutes } from '../src/modules/ai/plan-generator.js';
import { testServer } from './helpers.js';

const DRAFT = {
  objectives: ['Name the parts of a fraction ', '', 'Compare two fractions with the same bottom number'],
  steps: [
    { minutes: 5, title: 'Opening', what: 'Ask who has shared a roti in $\\frac{1}{2}$ .' },
    { minutes: 15, title: 'Teach', what: 'Show halves and quarters on the board.' },
    { minutes: 10, title: 'Practice', what: 'Students colour fractions on their PCs.' },
    { minutes: 5, title: 'Recap', what: 'Three students say one thing they learnt.' },
  ],
  checks: ['What is the top number called?', 'Which is bigger, 1/2 or 1/4?', ''],
  homework: ' Find three things at home that are cut into halves. ',
};

// A model that always writes the same draft, and remembers what it was asked.
function planLlm(draft: object = DRAFT) {
  const asked: LlmRequest<unknown>[] = [];
  const llm: Llm = { async json<T>(req: LlmRequest<T>) { asked.push(req as LlmRequest<unknown>); return draft as T; } };
  return { llm, asked };
}

async function setup(opts: { llm?: Llm; installed?: boolean } = {}) {
  const t = await testServer(opts.llm ? { ai: { llm: opts.llm, installed: opts.installed ?? true } } : {});
  const admin = t.auth(await t.login('admin', 'admin-pass'));
  const inject = (method: 'GET' | 'POST' | 'PUT', url: string, headers: object, payload?: object) =>
    t.app.inject({ method, url, headers: headers as Record<string, string>, ...(payload ? { payload } : {}) });
  const c7 = (await inject('POST', '/api/v1/classes', admin, { name: '7' })).json();
  const c8 = (await inject('POST', '/api/v1/classes', admin, { name: '8' })).json();
  await inject('POST', '/api/v1/staff', admin, { username: 'ravi', displayName: 'Ravi K', password: 'ravi-pass1', classIds: [c7.id], subjects: ['Maths'] });
  const ravi = t.auth(await t.login('ravi', 'ravi-pass1'));
  const plan = (who: object, body: object = {}, wait = true) =>
    inject('POST', `/api/v1/ai/plan${wait ? '?wait=1' : ''}`, who, { classId: c7.id, subject: 'Maths', topic: 'Fractions', ...body });
  return { ...t, admin, ravi, inject, c7, c8, plan };
}

describe('making the minutes of a plan add up', () => {
  const steps = (...m: number[]) => m.map((minutes, i) => ({ minutes, title: `S${i}`, what: '' }));
  const fitted = (total: number, ...m: number[]) => fitMinutes(steps(...m), total).map((s) => s.minutes);
  const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

  it('leaves a plan that already adds up as it is', () => {
    expect(fitted(40, 5, 15, 15, 5)).toEqual([5, 15, 15, 5]);
  });

  it('stretches or shrinks the steps, keeping their shares', () => {
    expect(fitted(40, 5, 15, 10, 5)).toEqual([6, 17, 11, 6]);
    expect(sum(fitted(40, 10, 30, 30, 10))).toBe(40);
    expect(fitted(40, 10, 30, 30, 10)).toEqual([5, 15, 15, 5]);
  });

  it('always adds up, and never leaves a step with no time', () => {
    for (const [total, m] of [[20, [1, 1, 100]], [45, [7, 7, 7]], [90, [0, -5, 3, NaN]], [20, [3, 3, 3, 3, 3, 3, 3]]] as [number, number[]][]) {
      const out = fitted(total, ...m);
      expect(sum(out), JSON.stringify(m)).toBe(total);
      expect(Math.min(...out), JSON.stringify(m)).toBeGreaterThanOrEqual(1);
    }
  });
});

describe('AI lesson plan', () => {
  it('gives a tidy plan whose minutes add up to what was asked', async () => {
    const { llm } = planLlm();
    const { plan, admin } = await setup({ llm });
    const res = await plan(admin, { minutes: 40 });
    expect(res.statusCode).toBe(200);
    const job = res.json();
    expect(job).toMatchObject({ kind: 'plan', status: 'done', request: { subject: 'Maths', topic: 'Fractions', minutes: 40, language: 'en' } });
    const r = job.result;
    expect(r.objectives).toEqual(['Name the parts of a fraction', 'Compare two fractions with the same bottom number']);
    expect(r.steps.map((s: { minutes: number }) => s.minutes)).toEqual([6, 17, 11, 6]);
    // LaTeX from the model is turned into plain text, as in quizzes.
    expect(r.steps[0]).toMatchObject({ title: 'Opening', what: 'Ask who has shared a roti in 1/2.' });
    expect(r.checks).toEqual(['What is the top number called?', 'Which is bigger, 1/2 or 1/4?']);
    expect(r.homework).toBe('Find three things at home that are cut into halves.');
    expect(r.library).toEqual([]);
  });

  it('plans for 40 minutes when no length is given, and refuses a length that is too short or too long', async () => {
    const { llm, asked } = planLlm();
    const { plan, admin } = await setup({ llm });
    expect((await plan(admin)).json().request.minutes).toBe(40);
    expect(asked[0]!.user).toContain('Plan one lesson of 40 minutes for Class 7.');
    expect((await plan(admin, { minutes: 10 })).statusCode).toBe(400);
    expect((await plan(admin, { minutes: 200 })).statusCode).toBe(400);
    expect((await plan(admin, { topic: '  ' })).statusCode).toBe(400);
  });

  it('tells the AI what the library has for that class and subject, and lists it with the plan', async () => {
    const { llm, asked } = planLlm();
    const { plan, admin, inject, c7, c8 } = await setup({ llm });
    const add = async (title: string, classId: string, subject: string) => {
      const bytes = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from(title)]);
      const { uploadId } = (await inject('POST', '/api/v1/content/uploads', admin, { fileName: 'f.pdf', size: bytes.length })).json();
      await inject('PUT', `/api/v1/content/uploads/${uploadId}/chunks`, admin, { index: 0, data: bytes.subarray(0, CHUNK_BYTES).toString('base64') });
      await inject('POST', `/api/v1/content/uploads/${uploadId}/finish`, admin, { title, classId, subject, chapter: 'Ch 2' });
    };
    await add('Fractions workbook', c7.id, 'maths');
    await add('Plants', c7.id, 'Science');
    await add('Fractions for class 8', c8.id, 'Maths');
    const res = await plan(admin);
    expect(res.json().result.library).toEqual([{ title: 'Fractions workbook', kind: 'pdf', chapter: 'Ch 2' }]);
    expect(asked[0]!.user).toContain('- Fractions workbook (book)');
    expect(asked[0]!.user).not.toMatch(/Plants|class 8/);
  });

  it('asks in the language chosen', async () => {
    const { llm, asked } = planLlm();
    const { plan, admin } = await setup({ llm });
    await plan(admin, { language: 'hi' });
    expect(asked[0]!.user).toContain('Hindi');
  });

  it('fails plainly when the AI writes no steps', async () => {
    const { plan, admin } = await setup({ llm: planLlm({ ...DRAFT, steps: [{ minutes: 5, title: ' ', what: '' }] }).llm });
    const job = (await plan(admin)).json();
    expect(job.status).toBe('failed');
    expect(job.error).toMatch(/usable plan/);
    expect(job.result).toBeNull();
  });

  it('without wait it gives a ticket, and the plan is on the job later and in the list of plans', async () => {
    const { plan, admin, inject, c } = await setup({ llm: planLlm().llm });
    const res = await plan(admin, {}, false);
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ kind: 'plan', status: 'queued', result: null });
    await c.aiQueue.idle();
    expect((await inject('GET', `/api/v1/ai/jobs/${res.json().id}`, admin)).json()).toMatchObject({ status: 'done' });
    expect((await inject('GET', '/api/v1/ai/jobs?kind=plan', admin)).json().map((j: { kind: string }) => j.kind)).toEqual(['plan']);
  });

  it('keeps a teacher to her own classes and subjects', async () => {
    const { plan, ravi, c8 } = await setup({ llm: planLlm().llm });
    expect((await plan(ravi)).statusCode).toBe(200);
    expect((await plan(ravi, { classId: c8.id })).statusCode).toBe(403);
    expect((await plan(ravi, { subject: 'Science' })).statusCode).toBe(403);
    expect((await plan(ravi, { classId: '00000000-0000-4000-8000-000000000000' })).statusCode).toBe(404);
  });

  it('says so when there is no AI on the server, or the Super Admin switched it off', async () => {
    const none = await setup();
    const res = await none.plan(none.admin);
    expect(res.statusCode).toBe(503);
    expect(res.json().code).toBe('AI_NOT_INSTALLED');

    const off = await setup({ llm: planLlm().llm });
    const settings = (await off.inject('GET', '/api/v1/settings', off.admin)).json();
    await off.inject('PUT', '/api/v1/settings', off.admin, { ...settings, aiEnabled: false });
    expect((await off.plan(off.admin)).json().code).toBe('AI_OFF');
  });

  it('is for staff, and writes the topic in the activity log', async () => {
    const { plan, admin, inject, enrolDevice, auth } = await setup({ llm: planLlm().llm });
    expect((await plan(auth(await enrolDevice()))).statusCode).toBe(403);
    expect((await plan({})).statusCode).toBe(401);
    await plan(admin);
    expect((await inject('GET', '/api/v1/audit', admin)).json()[0]).toMatchObject({ action: 'ai.plan.request', detail: { topic: 'Fractions' } });
  });
});
