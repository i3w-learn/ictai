import { describe, expect, it } from 'vitest';
import { MAX_NOTES_PER_STUDENT, NOTE_BODY_MAX } from '@ict/contracts';
import { testServer } from './helpers.js';

// Two Class 7 students, Asha and Kabir, each signed in on their own lab PC.
async function withStudents() {
  const t = await testServer();
  const teacher = t.auth(await t.login('teacher', 'teacher-pass'));
  const inject = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, headers: object, payload?: object) =>
    t.app.inject({ method, url, headers: headers as Record<string, string>, ...(payload ? { payload } : {}) });

  const c7 = (await inject('POST', '/api/v1/classes', teacher, { name: '7' })).json();
  async function student(name: string, pin: string) {
    const s = (await inject('POST', '/api/v1/students', teacher, { name, classId: c7.id, pin })).json();
    const device = t.auth(await t.enrolDevice('lab_pc'));
    const { token } = (await inject('POST', '/api/v1/auth/student/pin', device, { studentId: s.id, pin })).json();
    return t.auth(token);
  }
  const asha = await student('Asha', '1111');
  const kabir = await student('Kabir', '2222');
  return { ...t, inject, teacher, asha, kabir };
}

describe('My notes', () => {
  it('saves a note and gives it back', async () => {
    const { inject, asha } = await withStudents();
    const res = await inject('POST', '/api/v1/notes', asha, { title: '  Photosynthesis ', body: 'Plants make food from light.', subject: 'Science' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ title: 'Photosynthesis', body: 'Plants make food from light.', subject: 'Science' });

    const list = (await inject('GET', '/api/v1/notes', asha)).json();
    expect(list).toEqual([res.json()]);
  });

  it('lets the subject and the text be left out', async () => {
    const { inject, asha } = await withStudents();
    const note = (await inject('POST', '/api/v1/notes', asha, { title: 'To revise' })).json();
    expect(note).toMatchObject({ title: 'To revise', body: '', subject: null });
  });

  it('refuses a note with no title', async () => {
    const { inject, asha } = await withStudents();
    expect((await inject('POST', '/api/v1/notes', asha, { title: '   ', body: 'x' })).statusCode).toBe(400);
  });

  it('refuses a note that is too long, and takes one exactly at the limit', async () => {
    const { inject, asha } = await withStudents();
    expect((await inject('POST', '/api/v1/notes', asha, { title: 'Long', body: 'a'.repeat(NOTE_BODY_MAX + 1) })).statusCode).toBe(400);
    expect((await inject('POST', '/api/v1/notes', asha, { title: 'a'.repeat(121) })).statusCode).toBe(400);
    const ok = await inject('POST', '/api/v1/notes', asha, { title: 'a'.repeat(120), body: 'अ'.repeat(NOTE_BODY_MAX) });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().body).toHaveLength(NOTE_BODY_MAX);
  });

  it('lists the most recently changed note first', async () => {
    const { inject, asha, clock } = await withStudents();
    const first = (await inject('POST', '/api/v1/notes', asha, { title: 'First' })).json();
    clock.t += 1000;
    await inject('POST', '/api/v1/notes', asha, { title: 'Second' });
    clock.t += 1000;
    await inject('PUT', `/api/v1/notes/${first.id}`, asha, { title: 'First, changed' });

    const titles = (await inject('GET', '/api/v1/notes', asha)).json().map((n: { title: string }) => n.title);
    expect(titles).toEqual(['First, changed', 'Second']);
  });

  it('changes a note and moves its "last changed" time', async () => {
    const { inject, asha, clock } = await withStudents();
    const note = (await inject('POST', '/api/v1/notes', asha, { title: 'Draft', body: 'a', subject: 'Maths' })).json();
    clock.t += 5000;
    const res = await inject('PUT', `/api/v1/notes/${note.id}`, asha, { title: 'Final', body: 'b' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: note.id, title: 'Final', body: 'b', subject: null, createdAt: note.createdAt, updatedAt: note.createdAt + 5000 });
  });

  it('deletes a note', async () => {
    const { inject, asha } = await withStudents();
    const note = (await inject('POST', '/api/v1/notes', asha, { title: 'Gone soon' })).json();
    expect((await inject('DELETE', `/api/v1/notes/${note.id}`, asha)).statusCode).toBe(204);
    expect((await inject('GET', '/api/v1/notes', asha)).json()).toEqual([]);
    expect((await inject('DELETE', `/api/v1/notes/${note.id}`, asha)).statusCode).toBe(404);
  });

  it('keeps notes private: another student cannot see, change or delete them', async () => {
    const { inject, asha, kabir } = await withStudents();
    const note = (await inject('POST', '/api/v1/notes', asha, { title: 'Mine' })).json();

    expect((await inject('GET', '/api/v1/notes', kabir)).json()).toEqual([]);
    expect((await inject('PUT', `/api/v1/notes/${note.id}`, kabir, { title: 'Hacked' })).statusCode).toBe(404);
    expect((await inject('DELETE', `/api/v1/notes/${note.id}`, kabir)).statusCode).toBe(404);
    expect((await inject('GET', '/api/v1/notes', asha)).json()).toEqual([note]);
  });

  it('keeps notes private from staff too', async () => {
    const { inject, asha, teacher, login, auth } = await withStudents();
    const note = (await inject('POST', '/api/v1/notes', asha, { title: 'Mine' })).json();
    const admin = auth(await login('admin', 'admin-pass'));
    for (const who of [teacher, admin]) {
      expect((await inject('GET', '/api/v1/notes', who)).statusCode).toBe(403);
      expect((await inject('PUT', `/api/v1/notes/${note.id}`, who, { title: 'x' })).statusCode).toBe(403);
      expect((await inject('DELETE', `/api/v1/notes/${note.id}`, who)).statusCode).toBe(403);
    }
  });

  it('follows the student to another lab PC', async () => {
    const { inject, asha, enrolDevice, auth } = await withStudents();
    await inject('POST', '/api/v1/notes', asha, { title: 'From PC 1' });
    const ashaId = (await inject('GET', '/api/v1/auth/me', asha)).json().studentId;
    const { token } = (await inject('POST', '/api/v1/auth/student/pin', auth(await enrolDevice('lab_pc')), { studentId: ashaId, pin: '1111' })).json();
    expect((await inject('GET', '/api/v1/notes', auth(token))).json()).toEqual([expect.objectContaining({ title: 'From PC 1' })]);
  });

  it('stops at the note limit with a clear message', async () => {
    const { inject, asha, db } = await withStudents();
    const first = (await inject('POST', '/api/v1/notes', asha, { title: 'Note 1' })).json();
    const studentId = (db.prepare('SELECT student_id FROM student_notes WHERE id = ?').pluck().get(first.id)) as string;
    const insert = db.prepare('INSERT INTO student_notes (id, student_id, title, body, subject, created_at, updated_at) VALUES (?, ?, ?, ?, NULL, 0, 0)');
    for (let i = 1; i < MAX_NOTES_PER_STUDENT; i++) insert.run(`n-${i}`, studentId, `Note ${i + 1}`, '');

    const res = await inject('POST', '/api/v1/notes', asha, { title: 'One too many' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'NOTE_LIMIT' });
    // A full notebook can still be changed.
    expect((await inject('PUT', `/api/v1/notes/${first.id}`, asha, { title: 'Note 1, changed' })).statusCode).toBe(200);
  });
});
