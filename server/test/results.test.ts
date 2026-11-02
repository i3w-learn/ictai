import { describe, expect, it } from 'vitest';
import { testServer } from './helpers.js';

// Class 7: Asha gets 3/3, Rohan joins but answers nothing, Meera never plays. Class 8: Kabir.
async function withResults(subject: string | null = 'Maths') {
  const t = await testServer();
  const teacher = t.auth(await t.login('teacher', 'teacher-pass'));
  const admin = t.auth(await t.login('admin', 'admin-pass'));
  const inject = (method: 'GET' | 'POST' | 'DELETE', url: string, headers: object, payload?: object) =>
    t.app.inject({ method, url, headers: headers as Record<string, string>, ...(payload ? { payload } : {}) });
  const c7 = (await inject('POST', '/api/v1/classes', teacher, { name: '7' })).json();
  const c8 = (await inject('POST', '/api/v1/classes', teacher, { name: '8' })).json();
  const add = async (name: string, classId: string, pin: string) =>
    (await inject('POST', '/api/v1/students', teacher, { name, classId, pin })).json();
  const asha = await add('Asha', c7.id, '1111');
  const rohan = await add('Rohan', c7.id, '2222');
  const meera = await add('Meera', c7.id, '3333');
  const kabir = await add('Kabir', c8.id, '4444');
  const studentOn = async (studentId: string, pin: string) => {
    const device = t.auth(await t.enrolDevice('lab_pc'));
    return t.auth((await inject('POST', '/api/v1/auth/student/pin', device, { studentId, pin })).json().token);
  };

  const questions = [
    { text: '2 + 2 = ?', options: ['3', '4'], correct: 1, marks: 2 },
    { text: 'Capital of India?', options: ['Mumbai', 'New Delhi'], correct: 1, marks: 1 },
  ];
  const quiz = (await inject('POST', '/api/v1/quizzes', teacher, { title: 'Warm-up', classId: c7.id, subject, questions })).json();
  const run = (await inject('POST', '/api/v1/quiz-runs', teacher, { quizId: quiz.id })).json();
  const a = await studentOn(asha.id, '1111');
  const r = await studentOn(rohan.id, '2222');
  await inject('POST', '/api/v1/quiz-runs/join', a, { code: run.joinCode });
  await inject('POST', '/api/v1/quiz-runs/join', r, { code: run.joinCode });
  await inject('POST', `/api/v1/quiz-runs/${run.runId}/start`, teacher);
  await inject('POST', `/api/v1/quiz-runs/${run.runId}/answers`, a, { questionIndex: 0, choice: 1 });
  await inject('POST', `/api/v1/quiz-runs/${run.runId}/answers`, a, { questionIndex: 1, choice: 1 });
  await inject('POST', `/api/v1/quiz-runs/${run.runId}/end`, teacher);
  return { ...t, inject, teacher, admin, c7, c8, asha, rohan, meera, kabir, studentOn, a };
}

describe('results', () => {
  it('overview bands students and gives the class average', async () => {
    const { inject, teacher, c7 } = await withResults();
    const o = (await inject('GET', `/api/v1/results/overview?classId=${c7.id}`, teacher)).json();
    expect(o.counts).toEqual({ great: 1, growing: 0, needs: 1, none: 1 });
    expect(o.classAverage).toBe(50);
    expect(o.students.map((s: { name: string; band: string; average: number | null }) => [s.name, s.band, s.average])).toEqual([
      ['Rohan', 'needs', 0], ['Asha', 'great', 100], ['Meera', 'none', null],
    ]);
  });

  it('overview filters by class', async () => {
    const { inject, teacher, c7 } = await withResults();
    const all = (await inject('GET', '/api/v1/results/overview', teacher)).json();
    const seven = (await inject('GET', `/api/v1/results/overview?classId=${c7.id}`, teacher)).json();
    expect(all.students.map((s: { name: string }) => s.name)).toContain('Kabir');
    expect(seven.students.map((s: { name: string }) => s.name)).not.toContain('Kabir');
  });

  it('student page shows grade, subjects and history', async () => {
    const { inject, teacher, asha } = await withResults();
    const res = (await inject('GET', `/api/v1/results/students/${asha.id}`, teacher)).json();
    expect(res).toMatchObject({ student: { name: 'Asha', className: '7' }, attempts: 1, average: 100, grade: 'A+' });
    expect(res.subjects).toEqual([{ subject: 'Maths', attempts: 1, average: 100, grade: 'A+' }]);
    expect(res.history[0]).toMatchObject({ quizTitle: 'Warm-up', score: 3, totalMarks: 3, percent: 100 });
  });

  it('student page groups a quiz with no subject under "No subject"', async () => {
    const { inject, teacher, asha } = await withResults(null);
    const res = (await inject('GET', `/api/v1/results/students/${asha.id}`, teacher)).json();
    expect(res.subjects[0].subject).toBe('No subject');
  });

  it('student page with no quizzes has no grade', async () => {
    const { inject, teacher, meera } = await withResults();
    const res = (await inject('GET', `/api/v1/results/students/${meera.id}`, teacher)).json();
    expect(res).toMatchObject({ attempts: 0, average: null, grade: null, subjects: [], history: [] });
  });

  it('student page 404s for unknown or deleted students', async () => {
    const { inject, teacher, asha } = await withResults();
    expect((await inject('GET', '/api/v1/results/students/00000000-0000-4000-8000-000000000000', teacher)).statusCode).toBe(404);
    await inject('DELETE', `/api/v1/students/${asha.id}`, teacher);
    expect((await inject('GET', `/api/v1/results/students/${asha.id}`, teacher)).statusCode).toBe(404);
  });

  it('teachers list is Super Admin only', async () => {
    const { inject, teacher, admin } = await withResults();
    expect((await inject('GET', '/api/v1/results/teachers', teacher)).statusCode).toBe(403);
    const rows = (await inject('GET', '/api/v1/results/teachers', admin)).json();
    expect(rows.find((r: { username: string }) => r.username === 'teacher')).toMatchObject({
      quizzesMade: 1, runsHeld: 1, studentsReached: 2, lastSignInAt: expect.any(Number),
    });
  });

  it('students cannot read results', async () => {
    const { inject, a } = await withResults();
    expect((await inject('GET', '/api/v1/results/overview', a)).statusCode).toBe(403);
  });
});
