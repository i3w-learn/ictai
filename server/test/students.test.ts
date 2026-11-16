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
    payload: { name: 'Asha Verma', classId: cls.id, sectionId: sec.id, rollNo: '12' },
  });
  expect(res.statusCode).toBe(201);
  const device = await t.enrolDevice('lab_pc');
  // The student signs in on the lab PC the way the sign-in screen does.
  const signIn = () => t.app.inject({ method: 'POST', url: '/api/v1/auth/student/roll', headers: t.auth(device), payload: { classId: cls.id, sectionId: sec.id, rollNo: '12' } });
  return { ...t, staff: h, cls, student: res.json(), device: t.auth(device), signIn };
}

describe('student management', () => {
  it('rejects a duplicate class with 409', async () => {
    const { app, staff } = await withStudent();
    const res = await app.inject({ method: 'POST', url: '/api/v1/classes', headers: staff, payload: { name: '7' } });
    expect(res.statusCode).toBe(409);
  });

  it('lists a student with name, class, section and roll number, and nothing secret', async () => {
    const { app, staff, cls, student } = await withStudent();
    const list = (await app.inject({ method: 'GET', url: `/api/v1/students?classId=${cls.id}`, headers: staff })).json();
    expect(list).toEqual([{ id: student.id, name: 'Asha Verma', classId: cls.id, sectionId: student.sectionId, rollNo: '12' }]);
    expect(JSON.stringify(list)).not.toMatch(/pin|qr|hash|\$2[ab]\$/i);
  });

  it('treats "05" and "5" as one roll number when looking for a student who is already there', async () => {
    const { app, staff, cls } = await withStudent(); // Asha Verma, roll 12
    const add = (name: string, rollNo: string | null) => app.inject({ method: 'POST', url: '/api/v1/students', headers: staff, payload: { name, classId: cls.id, rollNo } });
    for (const roll of ['012', ' 12 ', '0012']) expect((await add('Asha Verma', roll)).json()).toMatchObject({ code: 'ALREADY_EXISTS' });
    expect((await add('asha verma', '12')).statusCode).toBe(409);
    expect((await add('Asha Verma', '120')).statusCode).toBe(201); // another number
    expect((await add('Bina Roy', '012')).statusCode).toBe(201); // another name may share the number
    expect((await add('Asha Verma', null)).statusCode).toBe(201); // no number is not the same as number 12
    expect((await add('Asha Verma', null)).statusCode).toBe(409);
    const bina = (await add('Bina Roy', '7')).json();
    const edit = await app.inject({ method: 'PATCH', url: `/api/v1/students/${bina.id}`, headers: staff, payload: { rollNo: '12' } });
    expect(edit.statusCode).toBe(409); // nor by changing a roll number afterwards
  });

  it('says in plain words what is wrong with something typed', async () => {
    const { app, staff, cls } = await withStudent();
    const post = async (url: string, payload: object) => (await app.inject({ method: 'POST', url, headers: staff, payload })).json();
    expect(await post('/api/v1/students', { name: 'N'.repeat(81), classId: cls.id })).toEqual({ code: 'BAD_REQUEST', message: 'The name is too long. Use at most 80 letters.' });
    expect(await post('/api/v1/students', { name: 'Kabir', classId: cls.id, rollNo: '1'.repeat(17) })).toEqual({ code: 'BAD_REQUEST', message: 'The roll number is too long. Use at most 16 letters.' });
    expect(await post('/api/v1/students', { name: '  ', classId: cls.id })).toEqual({ code: 'BAD_REQUEST', message: 'The name is missing.' });
    expect(await post('/api/v1/classes', { name: 'X'.repeat(40) })).toEqual({ code: 'BAD_REQUEST', message: 'The name is too long. Use at most 32 letters.' });
    const link = await post('/api/v1/content/links', { title: 'A link', classId: cls.id, url: 'example.org' });
    expect(link).toEqual({ code: 'BAD_REQUEST', message: 'Type a full web address starting with http:// or https://' });
  });

  it('has no PIN to set: a PIN sent with a new student is ignored, and the old PIN routes are gone', async () => {
    const { app, db, staff, cls, student, device } = await withStudent();
    const res = await app.inject({ method: 'POST', url: '/api/v1/students', headers: staff, payload: { name: 'Rohan', classId: cls.id, rollNo: '13', pin: '1234' } });
    expect(res.statusCode).toBe(201);
    expect(res.json()).not.toHaveProperty('hasPin');
    expect(db.prepare('SELECT COUNT(*) FROM students WHERE pin_hash IS NOT NULL OR enrol_code_hash IS NOT NULL').pluck().get()).toBe(0);
    for (const [method, url, headers] of [
      ['PUT', `/api/v1/students/${student.id}/pin`, staff],
      ['POST', `/api/v1/students/${student.id}/enrolment-code`, staff],
      ['POST', `/api/v1/classes/${cls.id}/enrolment-codes`, staff],
      ['POST', '/api/v1/auth/student/pin', device],
      ['POST', '/api/v1/auth/student/enrol', device],
    ] as const) {
      expect((await app.inject({ method, url, headers, payload: { studentId: student.id, pin: '1234', code: '123456' } })).statusCode).toBe(404);
    }
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
    expect(res.json()).toMatchObject({ name: 'Asha V', rollNo: '13' });
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
    const { app, db, staff, cls, student, device, auth, signIn } = await withStudent();
    const { token } = (await signIn()).json();

    expect((await app.inject({ method: 'DELETE', url: `/api/v1/students/${student.id}`, headers: staff })).statusCode).toBe(204);

    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(token) })).statusCode).toBe(401);
    const roster = await app.inject({ method: 'GET', url: `/api/v1/auth/student/roster?classId=${cls.id}`, headers: device });
    expect(roster.json()).toEqual([]);
    // Neither their roll number nor their card gets them in any more.
    expect((await signIn()).statusCode).toBe(404);
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/student/qr', headers: device, payload: { qrToken: student.qrToken } })).statusCode).toBe(401);
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

  it('signs in with class, section and roll number, as a student with their own permissions', async () => {
    const { app, auth, signIn } = await withStudent();
    const res = await signIn();
    expect(res.statusCode).toBe(201);
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(res.json().token) });
    expect(me.json()).toMatchObject({ kind: 'student', name: 'Asha Verma', permissions: ['results.view.own', 'ai.tutor'] });
  });

  it('ends the student session after 10 minutes idle', async () => {
    const { app, clock, auth, signIn } = await withStudent();
    const { token } = (await signIn()).json();
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

  it('blocks QR guessing on a lab PC after 5 unknown cards, for five minutes', async () => {
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
    expect(kabir).toMatchObject({ rollNo: '1' });
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
  it('logs an unknown card against the lab PC, without what was scanned', async () => {
    const { app, db, device } = await withStudent();
    await app.inject({ method: 'POST', url: '/api/v1/auth/student/qr', headers: device, payload: { qrToken: 'x'.repeat(32) } });
    const rows = db.prepare(`SELECT actor_kind, target, detail FROM audit_log WHERE action = 'student.signin.failed' ORDER BY id`).all() as { actor_kind: string; target: string | null; detail: string }[];
    expect(rows).toEqual([
      { actor_kind: 'device', target: null, detail: '{"method":"qr"}' },
    ]);
  });
});
