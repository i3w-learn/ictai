import { describe, expect, it } from 'vitest';
import { openRelay, testServer } from './helpers.js';

const Q = [{ text: '2 + 2 = ?', options: ['3', '4'], correct: 1, marks: 1 }];

// Admin sets up Class 7 (Asha) and Class 8 (Kabir), with Maths and Science quizzes,
// then adds Ravi, who teaches Maths to Class 7 only.
async function withRavi() {
  const t = await testServer({ ai: { llm: { json: () => new Promise(() => {}) }, installed: true } });
  const admin = t.auth(await t.login('admin', 'admin-pass'));
  const inject = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, headers: object, payload?: object) =>
    t.app.inject({ method, url, headers: headers as Record<string, string>, ...(payload ? { payload } : {}) });
  const c7 = (await inject('POST', '/api/v1/classes', admin, { name: '7' })).json();
  const c8 = (await inject('POST', '/api/v1/classes', admin, { name: '8' })).json();
  const asha = (await inject('POST', '/api/v1/students', admin, { name: 'Asha', classId: c7.id, pin: '1111' })).json();
  const kabir = (await inject('POST', '/api/v1/students', admin, { name: 'Kabir', classId: c8.id, pin: '4444' })).json();
  const quiz = async (title: string, classId: string, subject: string | null) =>
    (await inject('POST', '/api/v1/quizzes', admin, { title, classId, subject, questions: Q })).json();
  const maths7 = await quiz('Maths 7', c7.id, 'Maths');
  const science7 = await quiz('Science 7', c7.id, 'Science');
  const maths8 = await quiz('Maths 8', c8.id, 'Maths');

  const ravi = await inject('POST', '/api/v1/staff', admin, {
    username: 'ravi', displayName: 'Ravi K', password: 'ravi-pass1', classIds: [c7.id], subjects: ['Maths'],
  });
  const teacher = t.auth(await t.login('ravi', 'ravi-pass1'));
  return { ...t, inject, admin, teacher, ravi: ravi.json(), raviRes: ravi, c7, c8, asha, kabir, maths7, science7, maths8 };
}

// Asha plays a quiz and gets every answer right or wrong.
async function play(t: Awaited<ReturnType<typeof withRavi>>, quizId: string, choice: number) {
  const device = t.auth(await t.enrolDevice('lab_pc'));
  const a = t.auth((await t.inject('POST', '/api/v1/auth/student/pin', device, { studentId: t.asha.id, pin: '1111' })).json().token);
  const run = (await t.inject('POST', '/api/v1/quiz-runs', t.admin, { quizId })).json();
  await t.inject('POST', `/api/v1/quiz-runs/${run.runId}/join`, a);
  await t.inject('POST', `/api/v1/quiz-runs/${run.runId}/start`, t.admin);
  await t.inject('POST', `/api/v1/quiz-runs/${run.runId}/answers`, a, { questionIndex: 0, choice });
  await t.inject('POST', `/api/v1/quiz-runs/${run.runId}/end`, t.admin);
  return run;
}

describe('teacher classes and subjects', () => {
  it('the admin gives a new teacher classes and subjects', async () => {
    const { raviRes, c7, inject, teacher, admin } = await withRavi();
    expect(raviRes.statusCode).toBe(201);
    expect(raviRes.json()).toMatchObject({ classIds: [c7.id], subjects: ['Maths'] });
    expect((await inject('GET', '/api/v1/auth/me', teacher)).json()).toMatchObject({ classIds: [c7.id], subjects: ['Maths'] });
    expect((await inject('GET', '/api/v1/auth/me', admin)).json()).toMatchObject({ classIds: null, subjects: null });
  });

  it('a new teacher needs at least one class and one subject, and the class must exist', async () => {
    const { inject, admin, c7 } = await withRavi();
    const base = { username: 'meena', displayName: 'Meena', password: 'meena-pass' };
    expect((await inject('POST', '/api/v1/staff', admin, { ...base, classIds: [], subjects: ['Maths'] })).statusCode).toBe(400);
    expect((await inject('POST', '/api/v1/staff', admin, { ...base, classIds: [c7.id], subjects: [] })).statusCode).toBe(400);
    expect((await inject('POST', '/api/v1/staff', admin, { ...base, classIds: ['00000000-0000-4000-8000-000000000000'], subjects: ['Maths'] })).statusCode).toBe(404);
  });

  it('sees only their own classes', async () => {
    const { inject, teacher, c7 } = await withRavi();
    expect((await inject('GET', '/api/v1/classes', teacher)).json()).toEqual([c7]);
  });

  it('cannot add a class; only the admin sets those up', async () => {
    const { inject, teacher } = await withRavi();
    expect((await inject('POST', '/api/v1/classes', teacher, { name: '9' })).statusCode).toBe(403);
  });

  it('works with students of their classes only', async () => {
    const { inject, teacher, c7, c8, asha, kabir } = await withRavi();
    expect((await inject('GET', `/api/v1/students?classId=${c7.id}`, teacher)).json().map((s: { name: string }) => s.name)).toEqual(['Asha']);
    expect((await inject('GET', `/api/v1/students?classId=${c8.id}`, teacher)).statusCode).toBe(403);
    expect((await inject('POST', '/api/v1/students', teacher, { name: 'New', classId: c8.id })).statusCode).toBe(403);
    expect((await inject('PATCH', `/api/v1/students/${kabir.id}`, teacher, { name: 'K' })).statusCode).toBe(403);
    expect((await inject('DELETE', `/api/v1/students/${kabir.id}`, teacher)).statusCode).toBe(403);
    expect((await inject('POST', `/api/v1/classes/${c8.id}/cards`, teacher)).statusCode).toBe(403);
    expect((await inject('POST', `/api/v1/classes/${c7.id}/promote`, teacher, { toClassId: c8.id })).statusCode).toBe(403);
    expect((await inject('PATCH', `/api/v1/students/${asha.id}`, teacher, { name: 'Asha V' })).statusCode).toBe(200);
  });

  it('sees and makes quizzes only for their classes and subjects', async () => {
    const { inject, teacher, c7, c8, maths7, science7, maths8 } = await withRavi();
    expect((await inject('GET', '/api/v1/quizzes', teacher)).json().map((q: { title: string }) => q.title)).toEqual(['Maths 7']);
    expect((await inject('GET', `/api/v1/quizzes/${science7.id}`, teacher)).statusCode).toBe(403);
    expect((await inject('GET', `/api/v1/quizzes/${maths8.id}`, teacher)).statusCode).toBe(403);
    expect((await inject('DELETE', `/api/v1/quizzes/${science7.id}`, teacher)).statusCode).toBe(403);
    expect((await inject('POST', '/api/v1/quizzes', teacher, { title: 'x', classId: c7.id, subject: 'Science', questions: Q })).statusCode).toBe(403);
    expect((await inject('POST', '/api/v1/quizzes', teacher, { title: 'x', classId: c8.id, subject: 'Maths', questions: Q })).statusCode).toBe(403);
    expect((await inject('POST', '/api/v1/quizzes', teacher, { title: 'x', classId: c7.id, subject: null, questions: Q })).statusCode).toBe(403);
    expect((await inject('POST', '/api/v1/quizzes', teacher, { title: 'x', classId: c7.id, subject: 'maths', questions: Q })).statusCode).toBe(201);
    expect((await inject('PUT', `/api/v1/quizzes/${maths7.id}`, teacher, { title: 'x', classId: c8.id, subject: 'Maths', questions: Q })).statusCode).toBe(403);
  });

  it("cannot run or watch another class's quiz", async () => {
    const t = await withRavi();
    expect((await t.inject('POST', '/api/v1/quiz-runs', t.teacher, { quizId: t.maths8.id })).statusCode).toBe(403);
    const run = (await t.inject('POST', '/api/v1/quiz-runs', t.admin, { quizId: t.science7.id })).json();
    expect((await t.inject('GET', `/api/v1/quiz-runs/${run.runId}`, t.teacher)).statusCode).toBe(403);
    expect((await t.inject('POST', `/api/v1/quiz-runs/${run.runId}/end`, t.teacher)).statusCode).toBe(403);
    expect((await t.inject('GET', `/api/v1/quiz-runs?quizId=${t.science7.id}`, t.teacher)).statusCode).toBe(403);
    expect((await t.inject('POST', '/api/v1/quiz-runs', t.teacher, { quizId: t.maths7.id })).statusCode).toBe(201);
  });

  it('results show their classes and count their subjects only', async () => {
    const t = await withRavi();
    await play(t, t.maths7.id, 1);
    await play(t, t.science7.id, 0);
    const o = (await t.inject('GET', '/api/v1/results/overview', t.teacher)).json();
    expect(o.students.map((s: { name: string; average: number }) => [s.name, s.average])).toEqual([['Asha', 100]]);
    expect(o.classAverage).toBe(100);
    const page = (await t.inject('GET', `/api/v1/results/students/${t.asha.id}`, t.teacher)).json();
    expect(page.subjects.map((s: { subject: string }) => s.subject)).toEqual(['Maths']);
    expect((await t.inject('GET', `/api/v1/results/students/${t.kabir.id}`, t.teacher)).statusCode).toBe(403);
    expect((await t.inject('GET', `/api/v1/results/overview?classId=${t.c8.id}`, t.teacher)).statusCode).toBe(403);
    // The admin still sees both subjects.
    expect((await t.inject('GET', '/api/v1/results/overview', t.admin)).json().classAverage).toBe(50);
  });

  it('asks the AI only for their classes and subjects', async () => {
    const { inject, teacher, c7, c8 } = await withRavi();
    const ask = (classId: string, subject: string) => inject('POST', '/api/v1/ai/quiz', teacher, { classId, subject, topic: 'Fractions', count: 3 });
    expect((await ask(c8.id, 'Maths')).statusCode).toBe(403);
    expect((await ask(c7.id, 'Science')).statusCode).toBe(403);
    expect((await ask(c7.id, 'Maths')).statusCode).toBe(202);
  });

  it("changing a teacher's classes applies on the next request", async () => {
    const { inject, admin, teacher, ravi, c7, c8 } = await withRavi();
    const res = await inject('PATCH', `/api/v1/staff/${ravi.id}`, admin, { classIds: [c7.id, c8.id], subjects: ['Maths', 'Science'] });
    expect(res.json()).toMatchObject({ classIds: [c7.id, c8.id], subjects: ['Maths', 'Science'] });
    expect((await inject('GET', '/api/v1/classes', teacher)).json()).toHaveLength(2);
    expect((await inject('GET', '/api/v1/quizzes', teacher)).json()).toHaveLength(3);
  });

  it('a teacher from before this change, with nothing set, still sees everything', async () => {
    const { inject, auth, login } = await withRavi();
    const old = auth(await login('teacher', 'teacher-pass'));
    expect((await inject('GET', '/api/v1/classes', old)).json()).toHaveLength(2);
    expect((await inject('GET', '/api/v1/quizzes', old)).json()).toHaveLength(3);
  });
  it('cannot watch a class 8 run over the live socket', async () => {
    const t = await withRavi();
    const run8 = (await t.inject('POST', '/api/v1/quiz-runs', t.admin, { quizId: t.maths8.id })).json();
    const { ws, next } = await openRelay(t.app, t.teacher);
    ws.send(JSON.stringify({ t: 'join', room: `quiz:${run8.runId}`, id: 'j' }));
    expect(await next('error')).toMatchObject({ id: 'j', p: { code: 'FORBIDDEN' } });
    ws.terminate();
  });

  it('is told over the live socket when the admin takes the class away', async () => {
    const t = await withRavi();
    const run7 = (await t.inject('POST', '/api/v1/quiz-runs', t.teacher, { quizId: t.maths7.id })).json();
    const room = `quiz:${run7.runId}`;
    const { ws, got, next } = await openRelay(t.app, t.teacher);
    ws.send(JSON.stringify({ t: 'join', room }));
    await next('state');
    await t.inject('PATCH', `/api/v1/staff/${t.ravi.id}`, t.admin, { classIds: [t.c8.id] });
    const seen = got.length;
    t.c.relay.notify(room);
    expect((await next('error', seen)).p.code).toBe('FORBIDDEN');
    expect(got.slice(seen).filter((m) => m.t === 'state')).toHaveLength(0);
    ws.terminate();
  });
  it('an unknown class is "not found" on every route, never "not yours"', async () => {
    const t = await withRavi();
    const ghost = '00000000-0000-4000-8000-000000000000';
    expect((await t.inject('GET', `/api/v1/sections?classId=${ghost}`, t.teacher)).statusCode).toBe(404);
    expect((await t.inject('POST', '/api/v1/sections', t.teacher, { classId: ghost, name: 'A' })).statusCode).toBe(404);
    expect((await t.inject('GET', `/api/v1/students?classId=${ghost}`, t.teacher)).statusCode).toBe(404);
    expect((await t.inject('GET', `/api/v1/quizzes?classId=${ghost}`, t.teacher)).statusCode).toBe(404);
    expect((await t.inject('GET', `/api/v1/results/overview?classId=${ghost}`, t.teacher)).statusCode).toBe(404);
  });
});
