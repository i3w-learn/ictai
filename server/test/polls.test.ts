import { describe, expect, it } from 'vitest';
import { openRelay, testServer } from './helpers.js';

// Class 7 has Asha, Bina and Chand; Class 8 has Kabir. Ravi teaches Class 7 only.
async function school() {
  const t = await testServer();
  const admin = t.auth(await t.login('admin', 'admin-pass'));
  const inject = (method: 'GET' | 'POST' | 'DELETE', url: string, headers: object, payload?: object) =>
    t.app.inject({ method, url, headers: headers as Record<string, string>, ...(payload ? { payload } : {}) });
  const c7 = (await inject('POST', '/api/v1/classes', admin, { name: '7' })).json();
  const c8 = (await inject('POST', '/api/v1/classes', admin, { name: '8' })).json();
  const student = async (name: string, classId: string, rollNo: string) => {
    const s = (await inject('POST', '/api/v1/students', admin, { name, classId, rollNo })).json();
    return t.auth(await t.studentToken(s.id));
  };
  const asha = await student('Asha', c7.id, '1');
  const bina = await student('Bina', c7.id, '2');
  const chand = await student('Chand', c7.id, '3');
  const kabir = await student('Kabir', c8.id, '1');
  await inject('POST', '/api/v1/staff', admin, { username: 'ravi', displayName: 'Ravi K', password: 'ravi-pass1', classIds: [c7.id], subjects: ['Maths'] });
  const ravi = t.auth(await t.login('ravi', 'ravi-pass1'));
  const ask = (who: object, body: object) => inject('POST', '/api/v1/polls', who, body);
  const choice = (classId: string, question = 'Was this lesson easy?', options = ['Yes', 'No', 'Not sure']) => ({ classId, question, kind: 'choice', options });
  const open = async (who: object) => (await inject('GET', '/api/v1/polls/open', who)).json();
  const answer = (who: object, id: string, n: number) => inject('POST', `/api/v1/polls/${id}/answer`, who, { choice: n });
  const list = async (who: object, classId?: string) => (await inject('GET', `/api/v1/polls${classId ? `?classId=${classId}` : ''}`, who)).json();
  return { ...t, inject, admin, ravi, c7, c8, asha, bina, chand, kabir, ask, choice, open, answer, list };
}

describe('Polls', () => {
  it('shows a new poll to the students of that class only', async () => {
    const { admin, c7, asha, kabir, ask, choice, open } = await school();
    const res = await ask(admin, choice(c7.id));
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ question: 'Was this lesson easy?', kind: 'choice', className: '7', open: true, counts: [0, 0, 0], answered: 0, average: null });
    expect(await open(asha)).toEqual({ id: res.json().id, question: 'Was this lesson easy?', kind: 'choice', options: ['Yes', 'No', 'Not sure'], myChoice: null });
    expect(await open(kabir)).toBeNull();
  });

  it('counts the answers, with no names and no score', async () => {
    const { admin, c7, asha, bina, chand, ask, choice, answer, list } = await school();
    const poll = (await ask(admin, choice(c7.id))).json();
    expect((await answer(asha, poll.id, 0)).json()).toMatchObject({ myChoice: 0 });
    await answer(bina, poll.id, 0);
    await answer(chand, poll.id, 2);
    const [got] = await list(admin, c7.id);
    expect(got).toMatchObject({ counts: [2, 0, 1], answered: 3 });
    expect(JSON.stringify(got)).not.toMatch(/Asha|Bina|Chand|score|marks/);
  });

  it('lets a student change their answer while the poll is open, and counts them once', async () => {
    const { admin, c7, asha, ask, choice, answer, open, list } = await school();
    const poll = (await ask(admin, choice(c7.id))).json();
    await answer(asha, poll.id, 0);
    await answer(asha, poll.id, 1);
    expect((await open(asha)).myChoice).toBe(1);
    expect((await list(admin))[0]).toMatchObject({ counts: [0, 1, 0], answered: 1 });
  });

  it('takes 1 to 5 stars for a rating poll and gives the average', async () => {
    const { admin, c7, asha, bina, chand, ask, answer, list } = await school();
    const poll = (await ask(admin, { classId: c7.id, question: 'How well did you follow?', kind: 'rating' })).json();
    expect(poll).toMatchObject({ kind: 'rating', options: [], counts: [0, 0, 0, 0, 0], average: null });
    await answer(asha, poll.id, 5);
    await answer(bina, poll.id, 4);
    await answer(chand, poll.id, 4);
    expect((await list(admin))[0]).toMatchObject({ counts: [0, 0, 0, 2, 1], answered: 3, average: 4.3 });
    expect((await answer(asha, poll.id, 0)).statusCode).toBe(400);
    expect((await answer(asha, poll.id, 6)).statusCode).toBe(400);
  });

  it('closes a poll: students no longer see it and cannot answer, the counts stay', async () => {
    const { admin, inject, c7, asha, bina, ask, choice, answer, open, list } = await school();
    const poll = (await ask(admin, choice(c7.id))).json();
    await answer(asha, poll.id, 1);
    const closed = await inject('POST', `/api/v1/polls/${poll.id}/close`, admin);
    expect(closed.json()).toMatchObject({ open: false, counts: [0, 1, 0] });
    expect(await open(asha)).toBeNull();
    const late = await answer(bina, poll.id, 0);
    expect(late.statusCode).toBe(409);
    expect(late.json().code).toBe('POLL_CLOSED');
    expect((await list(admin))[0]).toMatchObject({ open: false, answered: 1 });
  });

  it('keeps one open poll per class: a new question closes the one before', async () => {
    const { admin, c7, c8, asha, kabir, ask, choice, open, list, clock } = await school();
    await ask(admin, choice(c7.id, 'First?'));
    await ask(admin, choice(c8.id, 'For class 8?'));
    clock.t += 1000;
    await ask(admin, choice(c7.id, 'Second?'));
    expect((await open(asha)).question).toBe('Second?');
    expect((await open(kabir)).question).toBe('For class 8?');
    expect((await list(admin, c7.id)).map((p: { question: string; open: boolean }) => [p.question, p.open])).toEqual([['Second?', true], ['First?', false]]);
  });

  it('refuses a poll with no question, too few or too many options, or options on a rating', async () => {
    const { admin, c7, ask } = await school();
    const bad = async (body: object) => (await ask(admin, { classId: c7.id, question: 'Q?', kind: 'choice', options: ['A', 'B'], ...body })).statusCode;
    expect(await bad({ question: '   ' })).toBe(400);
    expect(await bad({ options: ['Only one'] })).toBe(400);
    expect(await bad({ options: ['1', '2', '3', '4', '5', '6', '7'] })).toBe(400);
    expect(await bad({ options: ['A', ' '] })).toBe(400);
    expect(await bad({ kind: 'rating' })).toBe(400);
    expect(await bad({ kind: 'word-cloud' })).toBe(400);
    expect(await bad({ classId: '00000000-0000-4000-8000-000000000000' })).toBe(404);
    expect(await bad({})).toBe(201);
  });

  it('refuses an answer that is not on the screen, or to a poll of another class', async () => {
    const { admin, c7, asha, kabir, ask, choice, answer } = await school();
    const poll = (await ask(admin, choice(c7.id))).json();
    expect((await answer(asha, poll.id, 3)).statusCode).toBe(400);
    expect((await answer(asha, poll.id, -1)).statusCode).toBe(400);
    expect((await answer(kabir, poll.id, 0)).statusCode).toBe(404);
    expect((await answer(asha, '00000000-0000-4000-8000-000000000000', 0)).statusCode).toBe(404);
  });

  it('keeps a teacher to her own classes', async () => {
    const { admin, ravi, inject, c7, c8, ask, choice, list } = await school();
    expect((await ask(ravi, choice(c7.id))).statusCode).toBe(201);
    expect((await ask(ravi, choice(c8.id))).statusCode).toBe(403);
    const other = (await ask(admin, choice(c8.id, 'Not hers'))).json();
    expect((await list(ravi)).map((p: { question: string }) => p.question)).toEqual(['Was this lesson easy?']);
    expect((await inject('GET', `/api/v1/polls?classId=${c8.id}`, ravi)).statusCode).toBe(403);
    expect((await inject('POST', `/api/v1/polls/${other.id}/close`, ravi)).statusCode).toBe(404);
    expect((await inject('DELETE', `/api/v1/polls/${other.id}`, ravi)).statusCode).toBe(404);
  });

  it('deletes a poll with its answers', async () => {
    const { admin, inject, c7, asha, ask, choice, answer, open, list } = await school();
    const poll = (await ask(admin, choice(c7.id))).json();
    await answer(asha, poll.id, 0);
    expect((await inject('DELETE', `/api/v1/polls/${poll.id}`, admin)).statusCode).toBe(204);
    expect(await list(admin)).toEqual([]);
    expect(await open(asha)).toBeNull();
    expect((await inject('DELETE', `/api/v1/polls/${poll.id}`, admin)).statusCode).toBe(404);
  });

  it('keeps students and staff to their own sides', async () => {
    const { admin, inject, c7, asha, ask, choice, answer } = await school();
    const poll = (await ask(admin, choice(c7.id))).json();
    expect((await ask(asha, choice(c7.id))).statusCode).toBe(403);
    expect((await inject('GET', '/api/v1/polls', asha)).statusCode).toBe(403);
    expect((await inject('POST', `/api/v1/polls/${poll.id}/close`, asha)).statusCode).toBe(403);
    expect((await inject('GET', '/api/v1/polls/open', admin)).statusCode).toBe(403);
    expect((await answer(admin, poll.id, 0)).statusCode).toBe(403);
  });

  it('pushes the poll to the class at once, and each answer to the teacher', async () => {
    const { app, admin, c7, c8, asha, kabir, ask, choice, answer, inject } = await school();
    const student = await openRelay(app, asha as Record<string, string>);
    student.ws.send(JSON.stringify({ t: 'join', room: `poll:${c7.id}` }));
    expect((await student.next('state')).p).toBeNull();
    const teacher = await openRelay(app, admin);
    teacher.ws.send(JSON.stringify({ t: 'join', room: `poll:${c7.id}` }));
    await teacher.next('state');

    let sAt = student.got.length;
    let tAt = teacher.got.length;
    const poll = (await ask(admin, choice(c7.id))).json();
    expect((await student.next('state', sAt)).p).toMatchObject({ question: 'Was this lesson easy?', myChoice: null });
    expect((await teacher.next('state', tAt)).p).toMatchObject({ open: true, answered: 0 });

    sAt = student.got.length; tAt = teacher.got.length;
    await answer(asha, poll.id, 1);
    expect((await teacher.next('state', tAt)).p).toMatchObject({ counts: [0, 1, 0], answered: 1 });
    expect((await student.next('state', sAt)).p).toMatchObject({ myChoice: 1 });

    sAt = student.got.length; tAt = teacher.got.length;
    await inject('POST', `/api/v1/polls/${poll.id}/close`, admin);
    expect((await student.next('state', sAt)).p).toBeNull();
    expect((await teacher.next('state', tAt)).p).toMatchObject({ open: false, answered: 1 });

    // A student of another class cannot listen in.
    const other = await openRelay(app, kabir as Record<string, string>);
    other.ws.send(JSON.stringify({ t: 'join', room: `poll:${c7.id}` }));
    expect((await other.next('error')).p.code).toBe('FORBIDDEN');
    other.ws.send(JSON.stringify({ t: 'join', room: `poll:${c8.id}` }));
    expect((await other.next('state')).p).toBeNull();
    for (const s of [student, teacher, other]) s.ws.terminate();
  });
});
