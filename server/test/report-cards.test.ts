import { describe, expect, it } from 'vitest';
import { testServer } from './helpers.js';

const Q = [{ text: '2 + 2 = ?', options: ['3', '4'], correct: 1, marks: 1 }, { text: '3 + 3 = ?', options: ['6', '7'], correct: 0, marks: 1 }];

// Class 7 has Asha and Bina; Class 8 has Kabir. Ravi teaches Class 7 only.
async function school() {
  const t = await testServer();
  const admin = t.auth(await t.login('admin', 'admin-pass'));
  const inject = (method: 'GET' | 'POST' | 'PUT', url: string, headers: object, payload?: object) =>
    t.app.inject({ method, url, headers: headers as Record<string, string>, ...(payload ? { payload } : {}) });
  const c7 = (await inject('POST', '/api/v1/classes', admin, { name: '7' })).json();
  const c8 = (await inject('POST', '/api/v1/classes', admin, { name: '8' })).json();
  const student = async (name: string, classId: string, rollNo: string) => {
    await inject('POST', '/api/v1/students', admin, { name, classId, rollNo });
    const device = t.auth(await t.enrolDevice('lab_pc'));
    return t.auth((await inject('POST', '/api/v1/auth/student/roll', device, { classId, rollNo })).json().token);
  };
  const asha = await student('Asha', c7.id, '1');
  await student('Bina', c7.id, '2');
  await student('Kabir', c8.id, '1');
  await inject('POST', '/api/v1/staff', admin, { username: 'ravi', displayName: 'Ravi K', password: 'ravi-pass1', classIds: [c7.id], subjects: ['Maths'] });
  const ravi = t.auth(await t.login('ravi', 'ravi-pass1'));
  // Asha plays a quiz and gets `right` of two questions.
  const play = async (subject: string, right: number) => {
    const quiz = (await inject('POST', '/api/v1/quizzes', admin, { title: `${subject} quiz`, classId: c7.id, subject, questions: Q })).json();
    const run = (await inject('POST', '/api/v1/quiz-runs', admin, { quizId: quiz.id })).json();
    await inject('POST', `/api/v1/quiz-runs/${run.runId}/join`, asha);
    await inject('POST', `/api/v1/quiz-runs/${run.runId}/start`, admin);
    await inject('POST', `/api/v1/quiz-runs/${run.runId}/answers`, asha, { questionIndex: 0, choice: right >= 1 ? 1 : 0 });
    await inject('POST', `/api/v1/quiz-runs/${run.runId}/answers`, asha, { questionIndex: 1, choice: right >= 2 ? 0 : 1 });
    await inject('POST', `/api/v1/quiz-runs/${run.runId}/end`, admin);
  };
  const make = (who: object, classId = c7.id, term = 'Term 1') => inject('POST', '/api/v1/report-cards/make', who, { classId, term });
  const status = (who: object, id: string, to: string) => inject('PUT', `/api/v1/report-cards/${id}/status`, who, { status: to });
  return { ...t, inject, admin, ravi, c7, c8, asha, play, make, status };
}

describe('Report cards', () => {
  it('makes a draft card for every student of the class from their marks', async () => {
    const { admin, play, make } = await school();
    await play('Maths', 2);
    await play('Science', 1);
    const res = await make(admin);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ made: 2, refreshed: 0, kept: 0 });
    const [asha, bina] = res.json().cards;
    expect(asha).toMatchObject({ term: 'Term 1', status: 'draft', remarks: '', student: { name: 'Asha', rollNo: '1', className: '7' } });
    expect(asha.marks.quizzes).toMatchObject({ taken: 2, average: 75 });
    expect(asha.marks.subjects.map((s: { subject: string; average: number }) => [s.subject, s.average])).toEqual([['Maths', 100], ['Science', 50]]);
    expect(bina.marks.quizzes).toMatchObject({ taken: 0, average: null });
  });

  it('brings a draft up to date when made again, and never doubles a card', async () => {
    const { admin, play, make } = await school();
    await make(admin);
    await play('Maths', 2);
    const again = (await make(admin)).json();
    expect(again).toMatchObject({ made: 0, refreshed: 2, kept: 0 });
    expect(again.cards).toHaveLength(2);
    expect(again.cards[0].marks.quizzes.taken).toBe(1);
  });

  it('keeps the remarks, and a published card keeps its marks when cards are made again', async () => {
    const { inject, admin, play, make, status } = await school();
    const card = (await make(admin)).json().cards[0];
    expect((await inject('PUT', `/api/v1/report-cards/${card.id}/remarks`, admin, { remarks: '  Works hard. ' })).json().remarks).toBe('Works hard.');
    expect((await status(admin, card.id, 'published')).json().status).toBe('published');
    await play('Maths', 2);
    const again = (await make(admin)).json();
    expect(again).toMatchObject({ made: 0, refreshed: 1, kept: 1 });
    expect(again.cards[0]).toMatchObject({ status: 'published', remarks: 'Works hard.' });
    expect(again.cards[0].marks.quizzes.taken).toBe(0); // as it was when published
  });

  it('goes draft, published, frozen in that order only', async () => {
    const { admin, make, status } = await school();
    const card = (await make(admin)).json().cards[0];
    const early = await status(admin, card.id, 'frozen');
    expect(early.statusCode).toBe(409);
    expect(early.json().message).toBe('Publish the report card before you freeze it.');
    expect((await status(admin, card.id, 'published')).statusCode).toBe(200);
    expect((await status(admin, card.id, 'draft')).json().status).toBe('draft'); // taken back
    await status(admin, card.id, 'published');
    expect((await status(admin, card.id, 'frozen')).json().status).toBe('frozen');
  });

  it('never changes a frozen card again', async () => {
    const { inject, admin, play, make, status } = await school();
    const card = (await make(admin)).json().cards[0];
    await inject('PUT', `/api/v1/report-cards/${card.id}/remarks`, admin, { remarks: 'Final.' });
    await status(admin, card.id, 'published');
    await status(admin, card.id, 'frozen');
    await play('Maths', 2);

    expect((await inject('PUT', `/api/v1/report-cards/${card.id}/remarks`, admin, { remarks: 'Changed' })).json()).toMatchObject({ code: 'FROZEN' });
    for (const to of ['draft', 'published']) expect((await status(admin, card.id, to)).json()).toMatchObject({ code: 'FROZEN' });
    const after = (await make(admin)).json().cards[0];
    expect(after).toMatchObject({ status: 'frozen', remarks: 'Final.' });
    expect(after.marks).toEqual(card.marks);
  });

  it('keeps terms apart and lists them newest first', async () => {
    const { inject, admin, c7, make, clock } = await school();
    await make(admin, c7.id, 'Term 1');
    clock.t += 1000;
    await make(admin, c7.id, 'Term 2');
    expect((await inject('GET', `/api/v1/report-cards/terms?classId=${c7.id}`, admin)).json()).toEqual(['Term 2', 'Term 1']);
    expect((await inject('GET', `/api/v1/report-cards?classId=${c7.id}&term=Term%202`, admin)).json()).toHaveLength(2);
  });

  it('keeps a teacher to her own classes', async () => {
    const { inject, admin, ravi, c8, make, status } = await school();
    expect((await make(ravi)).statusCode).toBe(200);
    expect((await make(ravi, c8.id)).statusCode).toBe(403);
    const other = (await make(admin, c8.id)).json().cards[0];
    expect((await status(ravi, other.id, 'published')).statusCode).toBe(404);
    expect((await inject('PUT', `/api/v1/report-cards/${other.id}/remarks`, ravi, { remarks: 'x' })).statusCode).toBe(404);
    expect((await inject('GET', `/api/v1/report-cards?classId=${c8.id}&term=Term%201`, ravi)).statusCode).toBe(403);
  });

  it('is for staff only, and needs a term', async () => {
    const { inject, admin, asha, c7, make } = await school();
    expect((await make(asha)).statusCode).toBe(403);
    expect((await inject('POST', '/api/v1/report-cards/make', admin, { classId: c7.id, term: '  ' })).statusCode).toBe(400);
  });

  it('lets only the Super Admin freeze; a teacher publishes and takes back', async () => {
    const { ravi, admin, make, status } = await school();
    const card = (await make(ravi)).json().cards[0];
    expect((await status(ravi, card.id, 'published')).statusCode).toBe(200);
    const refused = await status(ravi, card.id, 'frozen');
    expect(refused.statusCode).toBe(403);
    expect(refused.json().message).toBe('Only the Super Admin can freeze a report card.');
    expect((await status(ravi, card.id, 'draft')).json().status).toBe('draft');
    await status(ravi, card.id, 'published');
    expect((await status(admin, card.id, 'frozen')).json().status).toBe('frozen');
  });

  it('moves a draft card with a student who changed class, and leaves a published one where it was', async () => {
    const { inject, admin, c7, c8, make, status, db } = await school();
    const cards7 = (await make(admin)).json().cards;
    const bina = cards7.find((c: { student: { name: string } }) => c.student.name === 'Bina');
    const asha = cards7.find((c: { student: { name: string } }) => c.student.name === 'Asha');
    await status(admin, asha.id, 'published');
    db.prepare('UPDATE students SET class_id = ? WHERE class_id = ?').run(c8.id, c7.id);

    const res = (await make(admin, c8.id)).json();
    expect(res).toMatchObject({ made: 1, refreshed: 1, kept: 1 }); // Kabir new, Bina's draft moved, Asha's published card kept
    expect(res.cards.map((c: { student: { name: string } }) => c.student.name).sort()).toEqual(['Bina', 'Kabir']);
    const old = (await inject('GET', `/api/v1/report-cards?classId=${c7.id}&term=Term%201`, admin)).json();
    expect(old.map((c: { id: string }) => c.id)).toEqual([asha.id]);
    expect(res.cards.find((c: { id: string }) => c.id === bina.id).student.className).toBe('8');
  });
});
