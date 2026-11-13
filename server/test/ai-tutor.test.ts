import { describe, expect, it } from 'vitest';
import { TUTOR_DAILY_CAP } from '@ict/contracts';
import type { Llm } from '../src/modules/ai/llm-client.js';
import { testServer } from './helpers.js';

// The fake model repeats the system prompt's class and the question, so a test can see what the tutor was told.
const seen: { system: string; user: string }[] = [];
const echo: Llm = {
  json: async ({ system, user, schema }) => {
    seen.push({ system, user });
    return schema.parse({ answer: `Think about it: ${user}` });
  },
};

async function setup(ai: { llm: Llm; installed: boolean } = { llm: echo, installed: true }) {
  seen.length = 0;
  const t = await testServer({ ai });
  const admin = t.auth(await t.login('admin', 'admin-pass'));
  const inject = (method: 'GET' | 'POST' | 'PUT', url: string, headers: object, payload?: object) =>
    t.app.inject({ method, url, headers: headers as Record<string, string>, ...(payload ? { payload } : {}) });
  const c5 = (await inject('POST', '/api/v1/classes', admin, { name: '5' })).json();
  const student = async (name: string, rollNo: string) => {
    await inject('POST', '/api/v1/students', admin, { name, classId: c5.id, rollNo });
    const device = t.auth(await t.enrolDevice('lab_pc'));
    return t.auth((await inject('POST', '/api/v1/auth/student/roll', device, { classId: c5.id, rollNo })).json().token);
  };
  const asha = await student('Asha', '1');
  const ask = (who: object, question = 'What is a fraction?') => inject('POST', '/api/v1/ai/tutor', who, { question });
  return { ...t, inject, admin, asha, student, ask };
}

describe('AI tutor for students', () => {
  it('takes a question, answers it, and tells the model which class the student is in', async () => {
    const { inject, asha, ask, c } = await setup();
    const res = await ask(asha);
    expect(res.statusCode).toBe(202);
    expect(res.json()).toMatchObject({ kind: 'tutor', status: 'queued', request: { question: 'What is a fraction?' } });
    await c.aiQueue.idle();
    const job = (await inject('GET', `/api/v1/ai/tutor/${res.json().id}`, asha)).json();
    expect(job).toMatchObject({ status: 'done', request: { question: 'What is a fraction?' }, result: { answer: 'Think about it: What is a fraction?' } });
    expect(seen[0]!.system).toMatch(/Class 5/);
    expect(seen[0]!.system).toMatch(/Do not write out the finished answer/);
  });

  it('shows the student their own questions and how many are left today', async () => {
    const { inject, asha, ask, c } = await setup();
    expect((await inject('GET', '/api/v1/ai/tutor', asha)).json()).toEqual({ leftToday: TUTOR_DAILY_CAP, dailyCap: TUTOR_DAILY_CAP, jobs: [] });
    await ask(asha);
    await c.aiQueue.idle();
    const mine = (await inject('GET', '/api/v1/ai/tutor', asha)).json();
    expect(mine.leftToday).toBe(TUTOR_DAILY_CAP - 1);
    expect(mine.jobs).toEqual([expect.objectContaining({ status: 'done', request: { question: 'What is a fraction?' } })]);
  });

  it('stops at the daily number and starts again the next day', async () => {
    const { inject, auth, enrolDevice, asha, ask, c, clock } = await setup();
    for (let i = 0; i < TUTOR_DAILY_CAP; i++) {
      expect((await ask(asha, `Question ${i}`)).statusCode).toBe(202);
      await c.aiQueue.idle();
    }
    const over = await ask(asha, 'One more');
    expect(over.statusCode).toBe(429);
    expect(over.json()).toMatchObject({ code: 'DAILY_CAP' });
    clock.t += 24 * 3600_000;
    // Next day she signs in again (yesterday's sign-in has timed out) and may ask again.
    const pc = auth(await enrolDevice('lab_pc'));
    const classId = (await inject('GET', '/api/v1/auth/student/classes', pc)).json()[0].id;
    const again = auth((await inject('POST', '/api/v1/auth/student/roll', pc, { classId, rollNo: '1' })).json().token);
    expect((await inject('GET', '/api/v1/ai/tutor', again)).json().leftToday).toBe(TUTOR_DAILY_CAP);
    expect((await ask(again, 'A new day')).statusCode).toBe(202);
  });

  it('lets a student ask one question at a time', async () => {
    const never: Llm = { json: () => new Promise(() => {}) };
    const { asha, ask } = await setup({ llm: never, installed: true });
    expect((await ask(asha)).statusCode).toBe(202);
    expect((await ask(asha, 'Another')).json()).toMatchObject({ code: 'AI_BUSY' });
  });

  it("never shows one student another student's question", async () => {
    const { inject, asha, student, ask, c } = await setup();
    const job = (await ask(asha, 'My private question')).json();
    await c.aiQueue.idle();
    const bina = await student('Bina', '2');
    expect((await inject('GET', `/api/v1/ai/tutor/${job.id}`, bina)).statusCode).toBe(404);
    expect((await inject('GET', '/api/v1/ai/tutor', bina)).json().jobs).toEqual([]);
  });

  it('keeps the question out of the activity log and out of staff AI lists', async () => {
    const { inject, admin, asha, ask, c } = await setup();
    const job = (await ask(asha, 'My private question')).json();
    await c.aiQueue.idle();
    const log = JSON.stringify((await inject('GET', '/api/v1/audit', admin)).json());
    expect(log).toContain('ai.tutor.request');
    expect(log).not.toContain('My private question');
    expect((await inject('GET', '/api/v1/ai/jobs', admin)).json()).toEqual([]);
    expect((await inject('GET', `/api/v1/ai/jobs/${job.id}`, admin)).statusCode).toBe(404);
  });

  it('says so when AI is switched off or not installed, and refuses an empty question', async () => {
    const { inject, admin, asha, ask } = await setup();
    expect((await ask(asha, '   ')).statusCode).toBe(400);
    await inject('PUT', '/api/v1/settings', admin, { schoolName: 'S', aiEnabled: false, periods: [] });
    expect((await ask(asha)).json()).toMatchObject({ code: 'AI_OFF' });
    const none = await setup({ llm: echo, installed: false });
    expect((await none.ask(none.asha)).json()).toMatchObject({ code: 'AI_NOT_INSTALLED' });
  });

  it('is for students only', async () => {
    const { inject, admin, ask } = await setup();
    expect((await ask(admin)).statusCode).toBe(403);
    expect((await inject('GET', '/api/v1/ai/tutor', admin)).statusCode).toBe(403);
    expect((await ask({})).statusCode).toBe(401);
  });
});
