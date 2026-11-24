import { describe, expect, it } from 'vitest';
import { testServer } from './helpers.js';

const QUESTIONS = [
  { text: '2 + 2 = ?', options: ['3', '4', '5'], correct: 1, marks: 2 },
  { text: 'Capital of India?', options: ['Mumbai', 'New Delhi'], correct: 1, marks: 1 },
];

// A Class 7 quiz (3 marks, 60 seconds a question) and five Class 7 students, each on their own lab PC.
async function withQuiz() {
  const t = await testServer();
  const teacher = t.auth(await t.login('teacher', 'teacher-pass'));
  const inject = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, headers: object, payload?: object) =>
    t.app.inject({ method, url, headers: headers as Record<string, string>, ...(payload ? { payload } : {}) });
  const c7 = (await inject('POST', '/api/v1/classes', teacher, { name: '7' })).json();
  const c8 = (await inject('POST', '/api/v1/classes', teacher, { name: '8' })).json();
  const quiz = (await inject('POST', '/api/v1/quizzes', teacher, { title: 'Maths warm-up', classId: c7.id, subject: 'Maths', secondsPerQuestion: 60, questions: QUESTIONS })).json();
  const student = async (name: string, rollNo: string, classId = c7.id) => {
    const s = (await inject('POST', '/api/v1/students', teacher, { name, classId, rollNo })).json();
    return { id: s.id as string, me: t.auth(await t.studentToken(s.id)) };
  };
  const open = async (extra: object = {}) => inject('POST', '/api/v1/quiz-runs', teacher, { quizId: quiz.id, ...extra });
  const on = (runId: string) => ({
    join: (me: object) => inject('POST', `/api/v1/quiz-runs/${runId}/join`, me),
    play: async (me: object) => (await inject('GET', `/api/v1/quiz-runs/${runId}/play`, me)).json(),
    answer: (me: object, questionIndex: number, choice: number) => inject('POST', `/api/v1/quiz-runs/${runId}/answers`, me, { questionIndex, choice }),
    finish: (me: object) => inject('POST', `/api/v1/quiz-runs/${runId}/finish`, me),
    retry: (me: object) => inject('POST', `/api/v1/quiz-runs/${runId}/retry`, me),
    view: async () => (await inject('GET', `/api/v1/quiz-runs/${runId}`, teacher)).json(),
  });
  return { ...t, inject, teacher, c7, c8, quiz, student, open, on };
}

describe('Practice: a quiz at your own speed', () => {
  it('is open at once, with no lobby and no clock', async () => {
    const { open, student, on } = await withQuiz();
    const run = (await open({ mode: 'practice' })).json();
    expect(run).toMatchObject({ kind: 'teacher', mode: 'practice', status: 'active' });
    const asha = await student('Asha', '1');
    const r = on(run.runId);
    expect((await r.join(asha.me)).json()).toMatchObject({ mode: 'practice', status: 'active', current: { index: 0, remainingMs: null } });
  });

  it('never times a question out, however long the student takes', async () => {
    const { open, student, on, clock } = await withQuiz();
    const r = on((await open({ mode: 'practice' })).json().runId);
    const asha = await student('Asha', '1');
    await r.join(asha.me);
    clock.t += 5 * 60_000; // five times what a live question allows (longer would end the student's own sign-in)
    expect((await r.play(asha.me)).current).toEqual({ index: 0, remainingMs: null });
    expect((await r.answer(asha.me, 0, 1)).statusCode).toBe(200);
    expect((await r.play(asha.me)).current).toEqual({ index: 1, remainingMs: null });
  });

  it('shows the student their practice quizzes, with tries and best score, and not as a live quiz', async () => {
    const { open, student, on, inject } = await withQuiz();
    const run = (await open({ mode: 'practice' })).json();
    const asha = await student('Asha', '1');
    const mine = async () => (await inject('GET', '/api/v1/quiz-runs/practice', asha.me)).json();
    expect(await mine()).toEqual([{ runId: run.runId, title: 'Maths warm-up', questionCount: 2, totalMarks: 3, tries: 0, best: null, finished: false }]);
    // The live-quiz invite on the student's home screen must not pop up for practice.
    expect((await inject('GET', '/api/v1/quiz-runs/open', asha.me)).json()).toEqual([]);
    const r = on(run.runId);
    await r.join(asha.me);
    await r.answer(asha.me, 0, 1);
    await r.answer(asha.me, 1, 0);
    expect((await r.finish(asha.me)).json()).toMatchObject({ finished: true, score: 2, tries: 1, best: 2 });
    expect(await mine()).toEqual([expect.objectContaining({ tries: 1, best: 2, finished: true })]);
  });

  it('lets the student try again, and keeps the best try', async () => {
    const { open, student, on } = await withQuiz();
    const r = on((await open({ mode: 'practice' })).json().runId);
    const asha = await student('Asha', '1');
    await r.join(asha.me);
    await r.answer(asha.me, 0, 1);
    await r.answer(asha.me, 1, 1);
    await r.finish(asha.me); // 3 of 3
    const again = (await r.retry(asha.me)).json();
    expect(again).toMatchObject({ finished: false, myAnswers: [null, null], current: { index: 0, remainingMs: null }, tries: 2, best: 3 });
    await r.answer(asha.me, 0, 0);
    await r.answer(asha.me, 1, 0);
    expect((await r.finish(asha.me)).json()).toMatchObject({ score: 0, best: 3, tries: 2 });
    expect((await r.view()).participants).toEqual([expect.objectContaining({ name: 'Asha', tries: 2, best: 3, finished: true })]);
  });

  it('refuses a second try before the first is finished, and any retry of a live quiz', async () => {
    const { open, student, on, inject, teacher } = await withQuiz();
    const practice = on((await open({ mode: 'practice' })).json().runId);
    const asha = await student('Asha', '1');
    await practice.join(asha.me);
    expect((await practice.retry(asha.me)).statusCode).toBe(409);
    await inject('POST', `/api/v1/quiz-runs/${(await practice.view()).runId}/end`, teacher);
    const liveRun = (await open()).json();
    const live = on(liveRun.runId);
    await live.join(asha.me);
    await inject('POST', `/api/v1/quiz-runs/${liveRun.runId}/start`, teacher);
    await live.finish(asha.me);
    expect((await live.retry(asha.me)).statusCode).toBe(409);
  });

  it('is for the class it was given to, and stops when the teacher ends it', async () => {
    const { open, student, on, inject, teacher, c8 } = await withQuiz();
    const run = (await open({ mode: 'practice' })).json();
    const r = on(run.runId);
    const kabir = await student('Kabir', '9', c8.id);
    expect((await r.join(kabir.me)).statusCode).toBe(403);
    expect((await inject('GET', '/api/v1/quiz-runs/practice', kabir.me)).json()).toEqual([]);
    const asha = await student('Asha', '1');
    await r.join(asha.me);
    await inject('POST', `/api/v1/quiz-runs/${run.runId}/end`, teacher);
    expect((await r.answer(asha.me, 0, 1)).statusCode).toBe(409);
    expect((await inject('GET', '/api/v1/quiz-runs/practice', asha.me)).json()).toEqual([]);
  });

  it('does not count towards results and report cards', async () => {
    const { open, student, on, inject, login, auth } = await withQuiz();
    const r = on((await open({ mode: 'practice' })).json().runId);
    const asha = await student('Asha', '1');
    await r.join(asha.me);
    await r.answer(asha.me, 0, 1);
    await r.finish(asha.me);
    const admin = auth(await login('admin', 'admin-pass'));
    const results = (await inject('GET', `/api/v1/results/students/${asha.id}`, admin)).json();
    expect(JSON.stringify(results)).not.toMatch(/Maths warm-up/);
  });

  it('hands the try in by itself when the last question is answered, so a PC switched off then loses nothing', async () => {
    const { open, student, on, inject } = await withQuiz();
    const r = on((await open({ mode: 'practice' })).json().runId);
    const asha = await student('Asha', '1');
    await r.join(asha.me);
    await r.answer(asha.me, 0, 1);
    await r.answer(asha.me, 1, 1); // the last question; the student's screen never calls "finish"
    expect(await r.play(asha.me)).toMatchObject({ finished: true, score: 3, best: 3 });
    expect((await r.view()).participants).toEqual([expect.objectContaining({ finished: true, best: 3 })]);
    expect((await inject('GET', '/api/v1/quiz-runs/practice', asha.me)).json()).toEqual([expect.objectContaining({ finished: true, best: 3 })]);
  });

  it('shows on the quiz list that practice is open, and after it ends where its scores are', async () => {
    const { open, inject, teacher, quiz } = await withQuiz();
    const list = async () => (await inject('GET', '/api/v1/quizzes', teacher)).json()[0];
    expect(await list()).toMatchObject({ open: null, lastPracticeRunId: null });
    const run = (await open({ mode: 'practice' })).json();
    expect(await list()).toMatchObject({ open: { runId: run.runId, mode: 'practice' }, lastPracticeRunId: null });
    await inject('POST', `/api/v1/quiz-runs/${run.runId}/end`, teacher);
    expect(await list()).toMatchObject({ open: null, lastPracticeRunId: run.runId });
    const live = (await open()).json();
    expect(await list()).toMatchObject({ open: { runId: live.runId, mode: 'live' }, lastPracticeRunId: run.runId });
    expect(quiz.id).toBeTruthy();
  });

  it('says plainly why a quiz cannot be changed or opened again while practice is open', async () => {
    const { open, inject, teacher, quiz, c7 } = await withQuiz();
    await open({ mode: 'practice' });
    const edit = await inject('PUT', `/api/v1/quizzes/${quiz.id}`, teacher, { title: 'Changed', classId: c7.id, questions: QUESTIONS });
    expect(edit.statusCode).toBe(409);
    expect(edit.json().message).toMatch(/practice/i);
    const again = await open();
    expect(again.statusCode).toBe(409);
    expect(again.json().message).toMatch(/practice/i);
  });

  it('cannot be given with teams', async () => {
    const { open } = await withQuiz();
    expect((await open({ mode: 'practice', teams: 2 })).statusCode).toBe(400);
  });
});

describe('Teams in a live quiz', () => {
  it('puts students into teams of the same size as they join', async () => {
    const { open, student, on } = await withQuiz();
    const run = (await open({ teams: 2 })).json();
    expect(run).toMatchObject({ mode: 'live', status: 'lobby', teams: [] });
    const r = on(run.runId);
    const teams: number[] = [];
    for (const [name, roll] of [['Asha', '1'], ['Bala', '2'], ['Chitra', '3'], ['Dev', '4'], ['Esha', '5']] as const) {
      teams.push((await r.join((await student(name, roll)).me)).json().team);
    }
    expect(teams).toEqual([1, 2, 1, 2, 1]);
  });

  it('keeps a student in the same team when they join again', async () => {
    const { open, student, on } = await withQuiz();
    const r = on((await open({ teams: 3 })).json().runId);
    const asha = await student('Asha', '1');
    const bala = await student('Bala', '2');
    await r.join(asha.me);
    await r.join(bala.me);
    expect((await r.join(asha.me)).json().team).toBe(1);
    expect((await r.join(bala.me)).json().team).toBe(2);
  });

  it("scores a team by the average of its members, so a bigger team gets no head start", async () => {
    const { open, student, on, inject, teacher } = await withQuiz();
    const run = (await open({ teams: 2 })).json();
    const r = on(run.runId);
    const asha = await student('Asha', '1'); // team 1
    const bala = await student('Bala', '2'); // team 2
    const chitra = await student('Chitra', '3'); // team 1
    for (const s of [asha, bala, chitra]) await r.join(s.me);
    await inject('POST', `/api/v1/quiz-runs/${run.runId}/start`, teacher);
    await r.answer(asha.me, 0, 1); // 2 marks
    await r.answer(bala.me, 0, 1); // 2 marks
    await r.answer(chitra.me, 0, 0); // 0 marks
    const view = await r.view();
    // Team 2: one member with 2. Team 1: two members with 2 and 0, so 1.
    expect(view.teams).toEqual([{ team: 2, members: 1, score: 2 }, { team: 1, members: 2, score: 1 }]);
    expect(view.participants.find((p: { name: string }) => p.name === 'Chitra')).toMatchObject({ team: 1, score: 0 });
  });

  it('shows a student their own team, and every team once they are done', async () => {
    const { open, student, on, inject, teacher } = await withQuiz();
    const run = (await open({ teams: 2 })).json();
    const r = on(run.runId);
    const asha = await student('Asha', '1');
    await r.join(asha.me);
    await inject('POST', `/api/v1/quiz-runs/${run.runId}/start`, teacher);
    expect(await r.play(asha.me)).toMatchObject({ team: 1, teams: null });
    await r.answer(asha.me, 0, 1);
    expect((await r.finish(asha.me)).json()).toMatchObject({ team: 1, teams: [{ team: 1, members: 1, score: 2 }] });
  });

  it('has no teams unless the teacher asks for them, and refuses a number that is not 2, 3 or 4', async () => {
    const { open, student, on } = await withQuiz();
    expect((await open({ teams: 5 })).statusCode).toBe(400);
    const run = (await open()).json();
    expect(run.teams).toEqual([]);
    expect((await on(run.runId).join((await student('Asha', '1')).me)).json()).toMatchObject({ team: null, teams: null });
  });
});
