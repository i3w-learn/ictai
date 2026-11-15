import { describe, expect, it } from 'vitest';
import { MAX_TRIES } from '@ict/contracts';
import { testServer } from './helpers.js';

// Class 7 (sections A: Asha, B: Bina) and Class 8 (Kabir). Ravi teaches Maths to Class 7 only.
async function school() {
  const t = await testServer();
  const admin = t.auth(await t.login('admin', 'admin-pass'));
  const inject = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, headers: object, payload?: object) =>
    t.app.inject({ method, url, headers: headers as Record<string, string>, ...(payload ? { payload } : {}) });
  const c7 = (await inject('POST', '/api/v1/classes', admin, { name: '7' })).json();
  const c8 = (await inject('POST', '/api/v1/classes', admin, { name: '8' })).json();
  const a = (await inject('POST', '/api/v1/sections', admin, { classId: c7.id, name: 'A' })).json();
  const b = (await inject('POST', '/api/v1/sections', admin, { classId: c7.id, name: 'B' })).json();
  const student = async (name: string, classId: string, sectionId: string | null, rollNo: string) => {
    const s = (await inject('POST', '/api/v1/students', admin, { name, classId, sectionId, rollNo })).json();
    const device = t.auth(await t.enrolDevice('lab_pc'));
    return { id: (s.student ?? s).id as string, as: t.auth((await inject('POST', '/api/v1/auth/student/roll', device, { classId, sectionId, rollNo })).json().token) };
  };
  const asha = await student('Asha', c7.id, a.id, '1');
  const bina = await student('Bina', c7.id, b.id, '2');
  const kabir = await student('Kabir', c8.id, null, '1');
  await inject('POST', '/api/v1/staff', admin, { username: 'ravi', displayName: 'Ravi K', password: 'ravi-pass1', classIds: [c7.id], subjects: ['Maths'] });
  const ravi = t.auth(await t.login('ravi', 'ravi-pass1'));
  const set = (who: object, body: object) => inject('POST', '/api/v1/assignments', who, body);
  const mine = async (who: object) => (await inject('GET', '/api/v1/work', who)).json();
  const hand = (who: object, id: string, body: string) => inject('POST', `/api/v1/work/${id}/answers`, who, { body });
  return { ...t, inject, admin, ravi, c7, c8, a, b, asha, bina, kabir, set, mine, hand };
}

describe('Work', () => {
  it('sets work for a class and shows it only to the students it is for', async () => {
    const { admin, c7, a, asha, bina, kabir, set, mine } = await school();
    const whole = await set(admin, { title: ' Fractions worksheet ', instructions: 'Answer all five.', classId: c7.id, subject: 'Maths' });
    expect(whole.statusCode).toBe(201);
    expect(whole.json()).toMatchObject({ title: 'Fractions worksheet', className: '7', sectionName: null, maxMarks: 10, students: 2, handedIn: 0, marked: 0 });
    await set(admin, { title: 'Section A only', classId: c7.id, sectionId: a.id });

    expect((await mine(asha.as)).map((w: { title: string }) => w.title).sort()).toEqual(['Fractions worksheet', 'Section A only']);
    expect((await mine(bina.as)).map((w: { title: string }) => w.title)).toEqual(['Fractions worksheet']);
    expect(await mine(kabir.as)).toEqual([]);
  });

  it('takes a student from to do, to handed in, to marked', async () => {
    const { inject, admin, c7, asha, set, mine, hand } = await school();
    const w = (await set(admin, { title: 'Essay', classId: c7.id, maxMarks: 5 })).json();
    expect(await mine(asha.as)).toEqual([expect.objectContaining({ status: 'todo', overdue: false, answer: null, mark: null })]);

    const handed = await hand(asha.as, w.id, '  My answer.  ');
    expect(handed.statusCode).toBe(201);
    expect(handed.json()).toMatchObject({ status: 'submitted', answer: { body: 'My answer.', late: false } });

    const marked = await inject('PUT', `/api/v1/assignments/${w.id}/marks/${asha.id}`, admin, { marks: 4, comment: ' Good work. ' });
    expect(marked.json().assignment).toMatchObject({ handedIn: 1, marked: 1 });
    expect(await mine(asha.as)).toEqual([expect.objectContaining({ status: 'marked', mark: expect.objectContaining({ marks: 4, comment: 'Good work.' }) })]);
  });

  it('keeps every answer a student hands in and marks the newest one', async () => {
    const { inject, admin, c7, asha, set, hand, db } = await school();
    const w = (await set(admin, { title: 'Essay', classId: c7.id })).json();
    await hand(asha.as, w.id, 'First try');
    await hand(asha.as, w.id, 'Second try');
    const line = (await inject('GET', `/api/v1/assignments/${w.id}`, admin)).json().answers.find((x: { studentId: string }) => x.studentId === asha.id);
    expect(line).toMatchObject({ name: 'Asha', tries: 2, answer: { body: 'Second try' } });
    expect(db.prepare('SELECT body FROM submissions ORDER BY id').pluck().all()).toEqual(['First try', 'Second try']);
  });

  it('stops a student changing an answer the teacher has marked', async () => {
    const { inject, admin, c7, asha, set, hand } = await school();
    const w = (await set(admin, { title: 'Essay', classId: c7.id })).json();
    await hand(asha.as, w.id, 'Done');
    await inject('PUT', `/api/v1/assignments/${w.id}/marks/${asha.id}`, admin, { marks: 7 });
    const again = await hand(asha.as, w.id, 'Changed my mind');
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('ALREADY_MARKED');
  });

  it('marks late work as late, and work not handed in past its date as overdue', async () => {
    const { admin, c7, asha, bina, set, mine, hand, clock } = await school();
    const w = (await set(admin, { title: 'Due soon', classId: c7.id, dueAt: clock.t + 60_000 })).json();
    clock.t += 61_000;
    expect((await mine(bina.as))[0]).toMatchObject({ status: 'todo', overdue: true });
    expect((await hand(asha.as, w.id, 'Sorry, late')).json()).toMatchObject({ status: 'submitted', overdue: false, answer: { late: true } });
  });

  it('lists every student of the class in roll order for marking, answered or not', async () => {
    const { inject, admin, c7, asha, set, hand } = await school();
    const w = (await set(admin, { title: 'Essay', classId: c7.id })).json();
    await hand(asha.as, w.id, 'Mine');
    const answers = (await inject('GET', `/api/v1/assignments/${w.id}`, admin)).json().answers;
    expect(answers.map((x: { name: string; tries: number; answer: unknown }) => [x.name, x.tries, x.answer === null])).toEqual([['Asha', 1, false], ['Bina', 0, true]]);
  });

  it('refuses marks above the maximum, marks with no answer, and a student the work is not for', async () => {
    const { inject, admin, c7, asha, bina, kabir, set, hand } = await school();
    const w = (await set(admin, { title: 'Essay', classId: c7.id, maxMarks: 5 })).json();
    await hand(asha.as, w.id, 'Mine');
    const mark = (studentId: string, marks: number) => inject('PUT', `/api/v1/assignments/${w.id}/marks/${studentId}`, admin, { marks });
    expect((await mark(asha.id, 6)).statusCode).toBe(400);
    expect((await mark(asha.id, -1)).statusCode).toBe(400);
    expect((await mark(bina.id, 3)).json()).toMatchObject({ code: 'NOT_HANDED_IN' });
    expect((await mark(kabir.id, 3)).statusCode).toBe(404);
    expect((await mark(asha.id, 5)).statusCode).toBe(200);
  });

  it('refuses bad work: no title, a past due date, a section of another class, an empty answer', async () => {
    const { admin, c7, c8, a, asha, set, hand, clock } = await school();
    expect((await set(admin, { title: ' ', classId: c7.id })).statusCode).toBe(400);
    expect((await set(admin, { title: 'Late', classId: c7.id, dueAt: clock.t - 1 })).statusCode).toBe(400);
    expect((await set(admin, { title: 'Wrong section', classId: c8.id, sectionId: a.id })).statusCode).toBe(400);
    expect((await set(admin, { title: 'Too many marks', classId: c7.id, maxMarks: 101 })).statusCode).toBe(400);
    const w = (await set(admin, { title: 'Essay', classId: c7.id })).json();
    expect((await hand(asha.as, w.id, '   ')).statusCode).toBe(400);
  });

  it('keeps a teacher to her own classes and subjects', async () => {
    const { inject, admin, ravi, c7, c8, set } = await school();
    expect((await set(ravi, { title: 'My class', classId: c7.id, subject: 'Maths' })).statusCode).toBe(201);
    expect((await set(ravi, { title: 'Not my class', classId: c8.id, subject: 'Maths' })).statusCode).toBe(403);
    expect((await set(ravi, { title: 'Not my subject', classId: c7.id, subject: 'Science' })).statusCode).toBe(403);
    const other = (await set(admin, { title: 'Class 8 work', classId: c8.id })).json();
    const science = (await set(admin, { title: 'Science work', classId: c7.id, subject: 'Science' })).json();
    expect((await inject('GET', '/api/v1/assignments', ravi)).json().map((w: { title: string }) => w.title)).toEqual(['My class']);
    for (const w of [other, science]) {
      expect((await inject('GET', `/api/v1/assignments/${w.id}`, ravi)).statusCode).toBe(404);
      expect((await inject('DELETE', `/api/v1/assignments/${w.id}`, ravi)).statusCode).toBe(404);
    }
  });

  it('takes work away from students but keeps what was handed in', async () => {
    const { inject, admin, c7, asha, set, mine, hand, db } = await school();
    const w = (await set(admin, { title: 'Essay', classId: c7.id })).json();
    await hand(asha.as, w.id, 'Mine');
    expect((await inject('DELETE', `/api/v1/assignments/${w.id}`, admin)).statusCode).toBe(204);
    expect(await mine(asha.as)).toEqual([]);
    expect((await hand(asha.as, w.id, 'Again')).statusCode).toBe(404);
    expect((await inject('GET', '/api/v1/assignments', admin)).json()).toEqual([]);
    expect(db.prepare('SELECT COUNT(*) FROM submissions').pluck().get()).toBe(1);
  });

  it("does not let a student answer another class's work, see the staff list, or mark", async () => {
    const { inject, admin, c7, asha, kabir, set, hand } = await school();
    const w = (await set(admin, { title: 'Essay', classId: c7.id })).json();
    expect((await hand(kabir.as, w.id, 'Not mine')).statusCode).toBe(404);
    expect((await inject('GET', '/api/v1/assignments', asha.as)).statusCode).toBe(403);
    expect((await inject('PUT', `/api/v1/assignments/${w.id}/marks/${asha.id}`, asha.as, { marks: 10 })).statusCode).toBe(403);
    expect((await inject('GET', '/api/v1/work', admin)).statusCode).toBe(403);
  });

  it('stores nothing new for the same answer sent again, and stops after the allowed number of tries', async () => {
    const { admin, c7, asha, set, hand, db } = await school();
    const w = (await set(admin, { title: 'Essay', classId: c7.id })).json();
    const count = () => db.prepare('SELECT COUNT(*) FROM submissions').pluck().get();
    expect((await hand(asha.as, w.id, 'Same')).statusCode).toBe(201);
    expect((await hand(asha.as, w.id, 'Same')).statusCode).toBe(201);
    expect(count()).toBe(1);
    for (let i = 1; i < MAX_TRIES; i++) expect((await hand(asha.as, w.id, `Try ${i}`)).statusCode).toBe(201);
    expect(count()).toBe(MAX_TRIES);
    const over = await hand(asha.as, w.id, 'One more');
    expect(over.statusCode).toBe(409);
    expect(over.json()).toMatchObject({ code: 'TOO_MANY_TRIES' });
    expect(count()).toBe(MAX_TRIES);
  });
});
