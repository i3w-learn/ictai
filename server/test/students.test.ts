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
    expect(roster.json()).toEqual([{ id: student.id, name: 'Asha V', rollNo: '13', sectionId: expect.any(String) }]);
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
    expect(roster.json()).toEqual([{ id: expect.any(String), name: 'Asha Verma', rollNo: '12', sectionId: expect.any(String) }]);

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

  it('blocks QR guessing on a lab PC after 5 unknown cards, like wrong PINs', async () => {
    const { app, student, device, clock } = await withStudent();
    const scan = (qrToken: string) => app.inject({ method: 'POST', url: '/api/v1/auth/student/qr', headers: device, payload: { qrToken } });
    for (let i = 0; i < 5; i++) expect((await scan(`${i}`.repeat(43))).statusCode).toBe(401);
    expect((await scan(student.qrToken)).statusCode).toBe(429);
    clock.t += 5 * 60_000 + 1;
    expect((await scan(student.qrToken)).statusCode).toBe(201);
  });

  it('a good card clears earlier bad scans', async () => {
    const { app, student, device } = await withStudent();
    const scan = (qrToken: string) => app.inject({ method: 'POST', url: '/api/v1/auth/student/qr', headers: device, payload: { qrToken } });
    for (let i = 0; i < 4; i++) await scan(`${i}`.repeat(43));
    expect((await scan(student.qrToken)).statusCode).toBe(201);
    for (let i = 0; i < 4; i++) await scan(`${i}`.repeat(43));
    expect((await scan(student.qrToken)).statusCode).toBe(201);
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

describe('student import from a spreadsheet', () => {
  it('adds the good rows and says why each other row was left out', async () => {
    const { app, staff, cls } = await withStudent();
    const res = await app.inject({
      method: 'POST', url: `/api/v1/classes/${cls.id}/students/import`, headers: staff,
      payload: { rows: [
        { name: ' Kabir Khan ', rollNo: '1', section: 'a' },
        { name: 'Meera', rollNo: null, section: null },
        { name: 'Asha Verma', rollNo: '12', section: 'A' },
        { name: '  ', rollNo: '3', section: null },
        { name: 'Ravi', rollNo: '4', section: 'Z' },
        { name: 'Kabir Khan', rollNo: '1', section: null },
      ] },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().added).toBe(2);
    expect(res.json().skipped.map((s: { row: number }) => s.row)).toEqual([3, 4, 5, 6]);
    expect(res.json().skipped[2].reason).toMatch(/Section "Z"/);

    const list = (await app.inject({ method: 'GET', url: `/api/v1/students?classId=${cls.id}`, headers: staff })).json();
    expect(list.map((s: { name: string }) => s.name).sort()).toEqual(['Asha Verma', 'Kabir Khan', 'Meera']);
    const kabir = list.find((s: { name: string }) => s.name === 'Kabir Khan');
    expect(kabir).toMatchObject({ rollNo: '1', hasPin: false });
    expect(kabir.sectionId).toBeTruthy();
  });

  it('refuses an empty list, too many rows, and a class the teacher does not have', async () => {
    const { app, staff, cls } = await withStudent();
    const post = (id: string, rows: unknown[]) => app.inject({ method: 'POST', url: `/api/v1/classes/${id}/students/import`, headers: staff, payload: { rows } });
    expect((await post(cls.id, [])).statusCode).toBe(400);
    expect((await post(cls.id, Array.from({ length: 501 }, (_, i) => ({ name: `S${i}` })))).statusCode).toBe(400);
    expect((await post('00000000-0000-4000-8000-000000000000', [{ name: 'X' }])).statusCode).toBe(404);
  });
});

describe('activity log for sign-in and quizzes', () => {
  it('logs a wrong PIN against the lab PC, without the PIN', async () => {
    const { app, db, student, device } = await withStudent();
    await app.inject({ method: 'POST', url: '/api/v1/auth/student/pin', headers: device, payload: { studentId: student.id, pin: '0000' } });
    await app.inject({ method: 'POST', url: '/api/v1/auth/student/qr', headers: device, payload: { qrToken: 'x'.repeat(32) } });
    const rows = db.prepare(`SELECT actor_kind, target, detail FROM audit_log WHERE action = 'student.signin.failed' ORDER BY id`).all() as { actor_kind: string; target: string | null; detail: string }[];
    expect(rows).toEqual([
      { actor_kind: 'device', target: student.id, detail: '{"method":"pin"}' },
      { actor_kind: 'device', target: null, detail: '{"method":"qr"}' },
    ]);
  });
});
