import { describe, expect, it } from 'vitest';
import { testServer } from './helpers.js';

const QUESTIONS = [
  { text: '2 + 2 = ?', options: ['3', '4', '5'], correct: 1, marks: 2 },
  { text: 'Capital of India?', options: ['Mumbai', 'New Delhi'], correct: 1, marks: 1 },
];

// A Class 7 quiz, a signed-in Class 7 student (Asha) and a Class 8 student (Kabir), each on their own lab PC.
async function withQuiz() {
  const t = await testServer();
  const teacher = t.auth(await t.login('teacher', 'teacher-pass'));
  const inject = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, headers: object, payload?: object) =>
    t.app.inject({ method, url, headers: headers as Record<string, string>, ...(payload ? { payload } : {}) });

  const c7 = (await inject('POST', '/api/v1/classes', teacher, { name: '7' })).json();
  const c8 = (await inject('POST', '/api/v1/classes', teacher, { name: '8' })).json();
  const asha = (await inject('POST', '/api/v1/students', teacher, { name: 'Asha', classId: c7.id, pin: '1111' })).json();
  const kabir = (await inject('POST', '/api/v1/students', teacher, { name: 'Kabir', classId: c8.id, pin: '2222' })).json();

  async function studentOn(studentId: string, pin: string) {
    const device = t.auth(await t.enrolDevice('lab_pc'));
    const { token } = (await inject('POST', '/api/v1/auth/student/pin', device, { studentId, pin })).json();
    return t.auth(token);
  }

  const quiz = (await inject('POST', '/api/v1/quizzes', teacher, { title: 'Maths warm-up', classId: c7.id, secondsPerQuestion: 60, questions: QUESTIONS })).json();
  const open = async () => (await inject('POST', '/api/v1/quiz-runs', teacher, { quizId: quiz.id })).json();
  return { ...t, inject, teacher, c7, c8, asha, kabir, studentOn, quiz, open };
}

describe('quizzes', () => {
  it('saves a quiz and totals its marks', async () => {
    const { inject, teacher, quiz, c7 } = await withQuiz();
    expect(quiz).toMatchObject({ title: 'Maths warm-up', totalMarks: 3, secondsPerQuestion: 60 });
    const list = (await inject('GET', `/api/v1/quizzes?classId=${c7.id}`, teacher)).json();
    expect(list).toEqual([expect.objectContaining({ id: quiz.id, questionCount: 2, totalMarks: 3 })]);
  });

  it('rejects a correct answer that is not one of the options', async () => {
    const { inject, teacher, c7 } = await withQuiz();
    const bad = [{ text: 'Q', options: ['a', 'b'], correct: 2, marks: 1 }];
    const res = await inject('POST', '/api/v1/quizzes', teacher, { title: 'Bad', classId: c7.id, questions: bad });
    expect(res.statusCode).toBe(400);
  });

  it('refuses to edit or delete a quiz while it is running', async () => {
    const { inject, teacher, quiz, open, c7 } = await withQuiz();
    await open();
    const body = { title: 'Changed', classId: c7.id, questions: QUESTIONS };
    expect((await inject('PUT', `/api/v1/quizzes/${quiz.id}`, teacher, body)).statusCode).toBe(409);
    expect((await inject('DELETE', `/api/v1/quizzes/${quiz.id}`, teacher)).statusCode).toBe(409);
  });
});

describe('Lab Mode', () => {
  it('opens a run with a 6-digit code', async () => {
    const { open } = await withQuiz();
    const run = await open();
    expect(run).toMatchObject({ kind: 'teacher', status: 'lobby', className: '7', joinCode: expect.stringMatching(/^\d{6}$/), participants: [] });
  });

  it('lets a student join by code and hides the correct answers', async () => {
    const { inject, open, asha, studentOn } = await withQuiz();
    const run = await open();
    const me = await studentOn(asha.id, '1111');
    const res = await inject('POST', '/api/v1/quiz-runs/join', me, { code: run.joinCode });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ kind: 'student', status: 'lobby', myAnswers: [null, null], score: null, totalMarks: 3 });
    expect(JSON.stringify(res.json())).not.toMatch(/correct/);
  });

  it('refuses a student from another class', async () => {
    const { inject, open, kabir, studentOn } = await withQuiz();
    const run = await open();
    const res = await inject('POST', '/api/v1/quiz-runs/join', await studentOn(kabir.id, '2222'), { code: run.joinCode });
    expect(res.statusCode).toBe(403);
    expect(res.json().message).toMatch(/Class 7/);
  });

  it('blocks code guessing after 5 wrong codes', async () => {
    const { inject, open, asha, studentOn } = await withQuiz();
    const run = await open();
    const me = await studentOn(asha.id, '1111');
    const wrong = run.joinCode === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i++) expect((await inject('POST', '/api/v1/quiz-runs/join', me, { code: wrong })).statusCode).toBe(404);
    expect((await inject('POST', '/api/v1/quiz-runs/join', me, { code: run.joinCode })).statusCode).toBe(429);
  });

  it('runs a whole quiz: lobby, answers, score, leaderboard, end', async () => {
    const { inject, teacher, open, asha, studentOn } = await withQuiz();
    const run = await open();
    const me = await studentOn(asha.id, '1111');
    await inject('POST', '/api/v1/quiz-runs/join', me, { code: run.joinCode });
    const answer = (questionIndex: number, choice: number) =>
      inject('POST', `/api/v1/quiz-runs/${run.runId}/answers`, me, { questionIndex, choice });

    expect((await answer(0, 1)).statusCode).toBe(409); // not started yet

    expect((await inject('POST', `/api/v1/quiz-runs/${run.runId}/start`, teacher)).json().status).toBe('active');
    expect((await answer(0, 1)).json()).toEqual({ accepted: true }); // right: 2 marks
    expect((await answer(1, 0)).json()).toEqual({ accepted: true }); // wrong

    const live = (await inject('GET', `/api/v1/quiz-runs/${run.runId}`, teacher)).json();
    expect(live.participants).toEqual([{ studentId: asha.id, name: 'Asha', rollNo: null, answered: 2, correct: 1, score: 2, finished: false }]);

    const done = (await inject('POST', `/api/v1/quiz-runs/${run.runId}/finish`, me)).json();
    expect(done).toMatchObject({ finished: true, score: 2, myAnswers: [1, 0] });
    expect((await answer(1, 1)).statusCode).toBe(409); // finished: no changes

    const ended = (await inject('POST', `/api/v1/quiz-runs/${run.runId}/end`, teacher)).json();
    expect(ended).toMatchObject({ status: 'ended', joinCode: null });
    expect(ended.participants[0]).toMatchObject({ score: 2, finished: true });
  });

  it('resending an answer is harmless: the first one counts', async () => {
    const { inject, teacher, open, asha, studentOn } = await withQuiz();
    const run = await open();
    const me = await studentOn(asha.id, '1111');
    await inject('POST', '/api/v1/quiz-runs/join', me, { code: run.joinCode });
    await inject('POST', `/api/v1/quiz-runs/${run.runId}/start`, teacher);
    await inject('POST', `/api/v1/quiz-runs/${run.runId}/answers`, me, { questionIndex: 0, choice: 1 });
    const again = await inject('POST', `/api/v1/quiz-runs/${run.runId}/answers`, me, { questionIndex: 0, choice: 2 });
    expect(again.json()).toEqual({ accepted: true });
    const state = (await inject('GET', `/api/v1/quiz-runs/${run.runId}/play`, me)).json();
    expect(state.myAnswers).toEqual([1, null]);
  });

  it('late joiner gets the active state', async () => {
    const { inject, teacher, open, asha, studentOn } = await withQuiz();
    const run = await open();
    await inject('POST', `/api/v1/quiz-runs/${run.runId}/start`, teacher);
    const state = (await inject('POST', '/api/v1/quiz-runs/join', await studentOn(asha.id, '1111'), { code: run.joinCode })).json();
    expect(state).toMatchObject({ status: 'active', questions: [{ text: '2 + 2 = ?' }, { text: 'Capital of India?' }] });
  });

  it('answers after end are refused, and the code stops working', async () => {
    const { inject, teacher, open, asha, studentOn } = await withQuiz();
    const run = await open();
    const me = await studentOn(asha.id, '1111');
    await inject('POST', '/api/v1/quiz-runs/join', me, { code: run.joinCode });
    await inject('POST', `/api/v1/quiz-runs/${run.runId}/start`, teacher);
    await inject('POST', `/api/v1/quiz-runs/${run.runId}/end`, teacher);
    const late = await inject('POST', `/api/v1/quiz-runs/${run.runId}/answers`, me, { questionIndex: 0, choice: 1 });
    expect(late.statusCode).toBe(409);
    expect(late.json().message).toMatch(/ended/);
    expect((await inject('POST', '/api/v1/quiz-runs/join', me, { code: run.joinCode })).statusCode).toBe(404);
    expect((await inject('GET', `/api/v1/quiz-runs/${run.runId}/play`, me)).json()).toMatchObject({ status: 'ended', score: 0 });
  });

  it('a student who did not join cannot see the run', async () => {
    const { inject, open, asha, studentOn } = await withQuiz();
    const run = await open();
    expect((await inject('GET', `/api/v1/quiz-runs/${run.runId}/play`, await studentOn(asha.id, '1111'))).statusCode).toBe(403);
  });

  it('a teacher who cannot host lessons cannot open a run', async () => {
    const { inject, db, quiz, teacher } = await withQuiz();
    db.prepare(`UPDATE users SET can_host_lessons = 0 WHERE username = 'teacher'`).run();
    expect((await inject('POST', '/api/v1/quiz-runs', teacher, { quizId: quiz.id })).statusCode).toBe(403);
  });
});

describe('Lab Mode live updates', () => {
  it('pushes the teacher a new state when a student joins and answers', async () => {
    const { app, inject, teacher, open, asha, studentOn } = await withQuiz();
    const run = await open();
    const got: any[] = [];
    let wake = () => {};
    const ws = await app.injectWS('/relay', { headers: teacher }, {
      onInit: (w) => w.on('message', (d) => { got.push(JSON.parse(d.toString())); wake(); }),
    });
    const nextState = async (pred: (p: any) => boolean) => {
      for (;;) {
        const hit = got.find((m) => m.t === 'state' && pred(m.p));
        if (hit) return hit.p;
        await new Promise<void>((r) => { wake = r; });
      }
    };

    ws.send(JSON.stringify({ t: 'join', room: `quiz:${run.runId}` }));
    expect((await nextState(() => true)).participants).toEqual([]);

    const me = await studentOn(asha.id, '1111');
    await inject('POST', '/api/v1/quiz-runs/join', me, { code: run.joinCode });
    expect((await nextState((p) => p.participants.length === 1)).participants[0].name).toBe('Asha');

    await inject('POST', `/api/v1/quiz-runs/${run.runId}/start`, teacher);
    await inject('POST', `/api/v1/quiz-runs/${run.runId}/answers`, me, { questionIndex: 0, choice: 1 });
    expect((await nextState((p) => p.participants[0]?.score === 2)).status).toBe('active');
    ws.terminate();
  });

  it('a student who has not joined cannot join the relay room', async () => {
    const { app, open, asha, studentOn } = await withQuiz();
    const run = await open();
    const me = await studentOn(asha.id, '1111');
    const got: any[] = [];
    let wake = () => {};
    const ws = await app.injectWS('/relay', { headers: me }, {
      onInit: (w) => w.on('message', (d) => { got.push(JSON.parse(d.toString())); wake(); }),
    });
    ws.send(JSON.stringify({ t: 'join', room: `quiz:${run.runId}` }));
    while (!got.some((m) => m.t === 'error')) await new Promise<void>((r) => { wake = r; });
    expect(got.find((m) => m.t === 'error').p.code).toBe('FORBIDDEN');
    ws.terminate();
  });
});
