import { describe, expect, it } from 'vitest';
import { dayText } from '@ict/contracts';
import { DAY } from '../src/core/clock.js';
import { testServer } from './helpers.js';

// Class 7 has Asha (roll 1), Bina (roll 2) and Chand (roll 10); Class 8 has Kabir. Ravi teaches Class 7 only.
async function school() {
  const t = await testServer();
  const admin = t.auth(await t.login('admin', 'admin-pass'));
  const inject = (method: 'GET' | 'POST' | 'PUT', url: string, headers: object, payload?: object) =>
    t.app.inject({ method, url, headers: headers as Record<string, string>, ...(payload ? { payload } : {}) });
  const c7 = (await inject('POST', '/api/v1/classes', admin, { name: '7' })).json();
  const c8 = (await inject('POST', '/api/v1/classes', admin, { name: '8' })).json();
  const add = async (name: string, classId: string, rollNo: string) => (await inject('POST', '/api/v1/students', admin, { name, classId, rollNo })).json().id as string;
  // Added out of order, to show the list comes back in roll order (10 after 2, not before).
  const chand = await add('Chand', c7.id, '10');
  const bina = await add('Bina', c7.id, '2');
  const asha = await add('Asha', c7.id, '1');
  const kabir = await add('Kabir', c8.id, '1');
  await inject('POST', '/api/v1/staff', admin, { username: 'ravi', displayName: 'Ravi K', password: 'ravi-pass1', classIds: [c7.id], subjects: ['Maths'] });
  const ravi = t.auth(await t.login('ravi', 'ravi-pass1'));
  const today = () => dayText(new Date(t.clock.t));
  const day = async (who: object, classId: string, date?: string) => (await inject('GET', `/api/v1/attendance?classId=${classId}${date ? `&date=${date}` : ''}`, who)).json();
  const mark = (who: object, studentId: string, body: object) => inject('PUT', `/api/v1/attendance/${studentId}`, who, body);
  const who = (d: { rows: { name: string; present: boolean }[] }) => d.rows.filter((r) => r.present).map((r) => r.name);
  return { ...t, inject, admin, ravi, c7, c8, asha, bina, chand, kabir, today, day, mark, who };
}

describe('Attendance', () => {
  it('lists the class in roll order, everyone absent until they sign in', async () => {
    const { admin, c7, day, today } = await school();
    const d = await day(admin, c7.id);
    expect(d.date).toBe(today());
    expect(d.today).toBe(today());
    expect(d.rows.map((r: { name: string }) => r.name)).toEqual(['Asha', 'Bina', 'Chand']);
    expect(d.rows.every((r: { present: boolean; by: unknown; at: unknown }) => !r.present && r.by === null && r.at === null)).toBe(true);
  });

  it('marks a student present when they sign in on a lab PC', async () => {
    const { admin, c7, asha, day, who, studentToken, clock } = await school();
    await studentToken(asha);
    const d = await day(admin, c7.id);
    expect(who(d)).toEqual(['Asha']);
    expect(d.rows[0]).toMatchObject({ name: 'Asha', rollNo: '1', present: true, by: 'signin', at: clock.t });
  });

  it('keeps the time of the first sign-in of the day', async () => {
    const { admin, c7, asha, day, studentToken, clock, db } = await school();
    const first = clock.t;
    await studentToken(asha);
    db.prepare("DELETE FROM sessions WHERE kind = 'student'").run();
    clock.t += 60_000;
    await studentToken(asha);
    expect((await day(admin, c7.id)).rows[0].at).toBe(first);
  });

  it('starts a fresh list every day and still shows the days gone by', async () => {
    const { c7, asha, bina, day, who, today, studentToken, clock, login, auth } = await school();
    const monday = today();
    await studentToken(asha);
    clock.t += DAY;
    await studentToken(bina);
    // A day later the teacher signs in again.
    const admin = auth(await login('admin', 'admin-pass'));
    expect(who(await day(admin, c7.id))).toEqual(['Bina']);
    expect(who(await day(admin, c7.id, monday))).toEqual(['Asha']);
  });

  it('lets a teacher mark a student present or absent, and that mark stays when the student signs in', async () => {
    const { admin, c7, asha, bina, day, mark, who, today, studentToken } = await school();
    const res = await mark(admin, bina, { date: today(), present: true });
    expect(res.statusCode).toBe(200);
    expect(who(res.json())).toEqual(['Bina']);
    expect(res.json().rows[1]).toMatchObject({ name: 'Bina', present: true, by: 'teacher' });

    // Someone signed in as Asha, but the teacher says she is not here.
    await studentToken(asha);
    await mark(admin, asha, { date: today(), present: false });
    expect(who(await day(admin, c7.id))).toEqual(['Bina']);
    expect((await day(admin, c7.id)).rows[0]).toMatchObject({ name: 'Asha', present: false, by: 'teacher' });
  });

  it('lets a teacher change a day gone by, but not a day to come', async () => {
    const { admin, c7, asha, day, mark, who, today, clock } = await school();
    const yesterday = dayText(new Date(clock.t - DAY));
    expect((await mark(admin, asha, { date: yesterday, present: true })).statusCode).toBe(200);
    expect(who(await day(admin, c7.id, yesterday))).toEqual(['Asha']);
    expect(who(await day(admin, c7.id, today()))).toEqual([]);

    const tomorrow = await mark(admin, asha, { date: dayText(new Date(clock.t + DAY)), present: true });
    expect(tomorrow.statusCode).toBe(400);
    expect(tomorrow.json().message).toMatch(/not come yet/);
  });

  it('refuses a date that is not a date, a student who is not there, and a class that is not there', async () => {
    const { admin, c7, asha, mark, inject } = await school();
    const none = '00000000-0000-4000-8000-000000000000';
    expect((await mark(admin, asha, { date: 'today', present: true })).statusCode).toBe(400);
    expect((await mark(admin, asha, { date: '2026-11-23' })).statusCode).toBe(400);
    expect((await mark(admin, none, { date: '2026-11-23', present: true })).statusCode).toBe(404);
    expect((await inject('GET', `/api/v1/attendance?classId=${none}`, admin)).statusCode).toBe(404);
    expect((await inject('GET', `/api/v1/attendance?classId=${c7.id}&date=23-11-2026`, admin)).statusCode).toBe(400);
  });

  it('keeps a teacher to her own classes', async () => {
    const { ravi, c7, c8, asha, kabir, mark, inject, today } = await school();
    expect((await inject('GET', `/api/v1/attendance?classId=${c7.id}`, ravi)).statusCode).toBe(200);
    expect((await inject('GET', `/api/v1/attendance?classId=${c8.id}`, ravi)).statusCode).toBe(403);
    expect((await mark(ravi, asha, { date: today(), present: true })).statusCode).toBe(200);
    expect((await mark(ravi, kabir, { date: today(), present: true })).statusCode).toBe(403);
  });

  it('is for staff only, and writes each change in the activity log', async () => {
    const { admin, c7, asha, mark, inject, today, studentToken, auth } = await school();
    const student = auth(await studentToken(asha));
    expect((await inject('GET', `/api/v1/attendance?classId=${c7.id}`, student)).statusCode).toBe(403);
    expect((await mark(student, asha, { date: today(), present: true })).statusCode).toBe(403);

    await mark(admin, asha, { date: today(), present: false });
    const log = (await inject('GET', '/api/v1/audit', admin)).json();
    expect(log[0]).toMatchObject({ action: 'attendance.mark', targetName: 'Asha', detail: { date: today(), present: false } });
  });
});
