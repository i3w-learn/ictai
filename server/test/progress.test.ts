import { describe, expect, it } from 'vitest';
import { testServer } from './helpers.js';

const Q = [{ text: '2 + 2 = ?', options: ['3', '4'], correct: 1, marks: 1 }, { text: '3 + 3 = ?', options: ['6', '7'], correct: 0, marks: 1 }];

async function school() {
  const t = await testServer();
  const admin = t.auth(await t.login('admin', 'admin-pass'));
  const inject = (method: 'GET' | 'POST' | 'PUT', url: string, headers: object, payload?: object) =>
    t.app.inject({ method, url, headers: headers as Record<string, string>, ...(payload ? { payload } : {}) });
  const c7 = (await inject('POST', '/api/v1/classes', admin, { name: '7' })).json();
  const student = async (name: string, rollNo: string) => {
    const s = (await inject('POST', '/api/v1/students', admin, { name, classId: c7.id, rollNo })).json();
    const device = t.auth(await t.enrolDevice('lab_pc'));
    return { id: (s.student ?? s).id as string, as: t.auth((await inject('POST', '/api/v1/auth/student/roll', device, { classId: c7.id, rollNo })).json().token) };
  };
  const asha = await student('Asha', '1');
  const bina = await student('Bina', '2');
  // A quiz the student plays, answering `right` of its two questions correctly.
  const play = async (who: { as: object }, subject: string, right: number) => {
    const quiz = (await inject('POST', '/api/v1/quizzes', admin, { title: `${subject} quiz`, classId: c7.id, subject, questions: Q })).json();
    const run = (await inject('POST', '/api/v1/quiz-runs', admin, { quizId: quiz.id })).json();
    await inject('POST', `/api/v1/quiz-runs/${run.runId}/join`, who.as);
    await inject('POST', `/api/v1/quiz-runs/${run.runId}/start`, admin);
    await inject('POST', `/api/v1/quiz-runs/${run.runId}/answers`, who.as, { questionIndex: 0, choice: right >= 1 ? 1 : 0 });
    await inject('POST', `/api/v1/quiz-runs/${run.runId}/answers`, who.as, { questionIndex: 1, choice: right >= 2 ? 0 : 1 });
    await inject('POST', `/api/v1/quiz-runs/${run.runId}/end`, admin);
  };
  const progress = async (who: { as: object }) => (await inject('GET', '/api/v1/me/progress', who.as)).json();
  return { ...t, inject, admin, c7, asha, bina, play, progress };
}

describe('How I am doing', () => {
  it('is empty and calm for a student who has done nothing yet', async () => {
    const { asha, progress } = await school();
    expect(await progress(asha)).toEqual({
      quizzes: { taken: 0, average: null, grade: null }, subjects: [], recent: [],
      work: { set: 0, handedIn: 0, onTime: 0, marked: 0, marksPercent: null }, tryNext: null,
    });
  });

  it('shows quiz results by subject and suggests the weakest subject', async () => {
    const { asha, play, progress } = await school();
    await play(asha, 'Maths', 2);
    await play(asha, 'Science', 1);
    const p = await progress(asha);
    expect(p.quizzes).toMatchObject({ taken: 2, average: 75 });
    expect(p.subjects.map((s: { subject: string; average: number }) => [s.subject, s.average])).toEqual([['Maths', 100], ['Science', 50]]);
    expect(p.recent).toHaveLength(2);
    expect(p.tryNext).toEqual({ kind: 'subject', subject: 'Science', average: 50 });
  });

  it('suggests nothing when every subject is going well', async () => {
    const { asha, play, progress } = await school();
    await play(asha, 'Maths', 2);
    expect((await progress(asha)).tryNext).toBeNull();
  });

  it('counts work set, handed in, on time and marked, and puts late work first in what to try', async () => {
    const { inject, admin, c7, asha, play, progress, clock } = await school();
    await play(asha, 'Science', 0);
    const set = async (title: string, more: object = {}) => (await inject('POST', '/api/v1/assignments', admin, { title, classId: c7.id, maxMarks: 10, ...more })).json();
    const onTime = await set('On time');
    const late = await set('Handed in late', { dueAt: clock.t + 1000 });
    await set('Never done', { dueAt: clock.t + 2000 });
    await inject('POST', `/api/v1/work/${onTime.id}/answers`, asha.as, { body: 'Done' });
    await inject('PUT', `/api/v1/assignments/${onTime.id}/marks/${asha.id}`, admin, { marks: 8 });
    clock.t += 5000;
    await inject('POST', `/api/v1/work/${late.id}/answers`, asha.as, { body: 'Sorry' });

    const p = await progress(asha);
    expect(p.work).toEqual({ set: 3, handedIn: 2, onTime: 1, marked: 1, marksPercent: 80 });
    expect(p.tryNext).toEqual({ kind: 'work', title: 'Never done' });
  });

  it("never shows another student's results", async () => {
    const { asha, bina, play, progress } = await school();
    await play(asha, 'Maths', 2);
    expect((await progress(bina)).quizzes.taken).toBe(0);
  });

  it('is for students only', async () => {
    const { inject, admin } = await school();
    expect((await inject('GET', '/api/v1/me/progress', admin)).statusCode).toBe(403);
    expect((await inject('GET', '/api/v1/me/progress', {})).statusCode).toBe(401);
  });
});
