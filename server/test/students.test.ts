import { describe, expect, it } from 'vitest';
import { testServer } from './helpers.js';

async function withStudent() {
  const t = await testServer();
  const staff = await t.login('teacher', 'teacher-pass');
  const h = t.auth(staff);
  const cls = (await t.app.inject({ method: 'POST', url: '/api/v1/classes', headers: h, payload: { name: '7' } })).json();
  const sec = (await t.app.inject({ method: 'POST', url: '/api/v1/sections', headers: h, payload: { classId: cls.id, name: 'A' } })).json();
  const res = await t.app.inject({
    method: 'POST', url: '/api/v1/students', headers: h,
    payload: { name: 'Asha Verma', classId: cls.id, sectionId: sec.id, rollNo: '12', pin: '4321' },
  });
  expect(res.statusCode).toBe(201);
  const device = await t.enrolDevice('lab_pc');
  return { ...t, staff: h, cls, student: res.json(), device: t.auth(device) };
}

describe('student management', () => {
  it('rejects a duplicate class with 409', async () => {
    const { app, staff } = await withStudent();
    const res = await app.inject({ method: 'POST', url: '/api/v1/classes', headers: staff, payload: { name: '7' } });
    expect(res.statusCode).toBe(409);
  });

  it('never returns PIN hashes, only whether a PIN is set', async () => {
    const { app, staff, cls } = await withStudent();
    const list = (await app.inject({ method: 'GET', url: `/api/v1/students?classId=${cls.id}`, headers: staff })).json();
    expect(list).toEqual([expect.objectContaining({ name: 'Asha Verma', hasPin: true })]);
    expect(JSON.stringify(list)).not.toMatch(/pin_hash|\$2[ab]\$/);
  });
});

describe('student edit and delete', () => {
  it('lists sections for a class', async () => {
    const { app, staff, cls } = await withStudent();
    const res = await app.inject({ method: 'GET', url: `/api/v1/sections?classId=${cls.id}`, headers: staff });
    expect(res.json()).toEqual([{ id: expect.any(String), classId: cls.id, name: 'A' }]);
  });

  it('edits a student', async () => {
    const { app, staff, cls, student, device } = await withStudent();
    const res = await app.inject({ method: 'PATCH', url: `/api/v1/students/${student.id}`, headers: staff, payload: { name: 'Asha V', rollNo: '13' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ name: 'Asha V', rollNo: '13', hasPin: true });
    const roster = await app.inject({ method: 'GET', url: `/api/v1/auth/student/roster?classId=${cls.id}`, headers: device });
    expect(roster.json()).toEqual([{ id: student.id, name: 'Asha V', rollNo: '13' }]);
  });

  it('rejects a section from another class', async () => {
    const { app, staff, student } = await withStudent();
    const other = (await app.inject({ method: 'POST', url: '/api/v1/classes', headers: staff, payload: { name: '8' } })).json();
    const sec = (await app.inject({ method: 'POST', url: '/api/v1/sections', headers: staff, payload: { classId: other.id, name: 'B' } })).json();
    const res = await app.inject({ method: 'PATCH', url: `/api/v1/students/${student.id}`, headers: staff, payload: { sectionId: sec.id } });
    expect(res.statusCode).toBe(404);
  });

  it('deleting a student ends their session and hides them', async () => {
    const { app, db, staff, cls, student, device, auth } = await withStudent();
    const { token } = (await app.inject({ method: 'POST', url: '/api/v1/auth/student/pin', headers: device, payload: { studentId: student.id, pin: '4321' } })).json();
    const { code } = (await app.inject({ method: 'POST', url: `/api/v1/students/${student.id}/enrolment-code`, headers: staff })).json();

    expect((await app.inject({ method: 'DELETE', url: `/api/v1/students/${student.id}`, headers: staff })).statusCode).toBe(204);

    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(token) })).statusCode).toBe(401);
    const roster = await app.inject({ method: 'GET', url: `/api/v1/auth/student/roster?classId=${cls.id}`, headers: device });
    expect(roster.json()).toEqual([]);
    const enrol = await app.inject({ method: 'POST', url: '/api/v1/auth/student/enrol', headers: device, payload: { code, pin: '1111' } });
    expect(enrol.statusCode).toBe(401);
    const logged = db.prepare(`SELECT target FROM audit_log WHERE action = 'student.delete'`).get();
    expect(logged).toEqual({ target: student.id });
  });
});

describe('student sign-in on a lab PC', () => {
  it('shows classes and names to an enrolled lab PC only', async () => {
    const { app, cls, device, enrolDevice, auth } = await withStudent();
    const roster = await app.inject({ method: 'GET', url: `/api/v1/auth/student/roster?classId=${cls.id}`, headers: device });
    expect(roster.json()).toEqual([{ id: expect.any(String), name: 'Asha Verma', rollNo: '12' }]);

    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/student/classes' })).statusCode).toBe(401);
    const board = auth(await enrolDevice('board'));
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/student/classes', headers: board })).statusCode).toBe(403);
  });

  it('signs in with the right PIN and the session is bound to the PC', async () => {
    const { app, student, device, auth } = await withStudent();
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/student/pin', headers: device, payload: { studentId: student.id, pin: '4321' } });
    expect(res.statusCode).toBe(201);
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(res.json().token) });
    expect(me.json()).toMatchObject({ kind: 'student', name: 'Asha Verma', permissions: ['results.view.own', 'ai.tutor'] });
  });

  it('locks the PIN after 5 wrong tries', async () => {
    const { app, student, device } = await withStudent();
    const tryPin = (pin: string) =>
      app.inject({ method: 'POST', url: '/api/v1/auth/student/pin', headers: device, payload: { studentId: student.id, pin } });
    for (let i = 0; i < 5; i++) expect((await tryPin('0000')).statusCode).toBe(401);
    expect((await tryPin('4321')).statusCode).toBe(429);
  });

  it('ends the student session after 10 minutes idle', async () => {
    const { app, clock, student, device, auth } = await withStudent();
    const { token } = (await app.inject({ method: 'POST', url: '/api/v1/auth/student/pin', headers: device, payload: { studentId: student.id, pin: '4321' } })).json();
    clock.t += 11 * 60_000;
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(token) })).statusCode).toBe(401);
  });

  it('signs in with the QR card token', async () => {
    const { app, student, device } = await withStudent();
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/student/qr', headers: device, payload: { qrToken: student.qrToken } });
    expect(res.statusCode).toBe(201);
    const bad = await app.inject({ method: 'POST', url: '/api/v1/auth/student/qr', headers: device, payload: { qrToken: 'x'.repeat(43) } });
    expect(bad.statusCode).toBe(401);
  });

  it('uses a one-time enrolment code to set the first PIN', async () => {
    const { app, staff, student, device } = await withStudent();
    const { code } = (await app.inject({ method: 'POST', url: `/api/v1/students/${student.id}/enrolment-code`, headers: staff })).json();
    const first = await app.inject({ method: 'POST', url: '/api/v1/auth/student/enrol', headers: device, payload: { code, pin: '9876' } });
    expect(first.statusCode).toBe(201);
    const reuse = await app.inject({ method: 'POST', url: '/api/v1/auth/student/enrol', headers: device, payload: { code, pin: '1111' } });
    expect(reuse.statusCode).toBe(401);
    const withNewPin = await app.inject({ method: 'POST', url: '/api/v1/auth/student/pin', headers: device, payload: { studentId: student.id, pin: '9876' } });
    expect(withNewPin.statusCode).toBe(201);
  });
});
