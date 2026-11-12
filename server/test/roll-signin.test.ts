import { describe, expect, it } from 'vitest';
import { testServer } from './helpers.js';

// Easy sign-in: class, section and roll number, with no PIN. Only students the teacher added get in.
async function lab() {
  const t = await testServer();
  const admin = t.auth(await t.login('admin', 'admin-pass'));
  const send = (method: 'GET' | 'POST' | 'PATCH', url: string, headers: object, payload?: object) =>
    t.app.inject({ method, url, headers: headers as Record<string, string>, ...(payload ? { payload } : {}) });
  const c7 = (await send('POST', '/api/v1/classes', admin, { name: '7' })).json();
  const pc = async () => t.auth(await t.enrolDevice('lab_pc'));
  const add = async (name: string, rollNo: string, more: object = {}) => (await send('POST', '/api/v1/students', admin, { name, classId: c7.id, rollNo, ...more })).json();
  const roll = (device: object, body: object) => send('POST', '/api/v1/auth/student/roll', device, { classId: c7.id, ...body });
  const students = async () => (await send('GET', `/api/v1/students?classId=${c7.id}`, admin)).json();
  return { ...t, admin, send, c7, pc, add, roll, students };
}

describe('Sign-in with class and roll number', () => {
  it('signs in a student the teacher added, with only the roll number', async () => {
    const { roll, pc, add } = await lab();
    await add('Asha', '5');
    const res = await roll(await pc(), { rollNo: '5' });
    expect(res.statusCode).toBe(201);
    expect(res.json().principal).toMatchObject({ kind: 'student', name: 'Asha' });
  });

  it('turns away a roll number the teacher has not added, and adds nobody', async () => {
    const { roll, pc, add, students } = await lab();
    await add('Asha', '5');
    const device = await pc();
    // A name sent along changes nothing: a student cannot add themselves.
    for (const body of [{ rollNo: '6' }, { rollNo: '6', name: 'Kabir' }]) {
      const res = await roll(device, body);
      expect(res.statusCode).toBe(404);
      expect(res.json()).toMatchObject({ code: 'ROLL_UNKNOWN', message: 'Roll number 6 is not in this class. Ask your teacher to add you.' });
    }
    expect((await students()).map((s: { name: string }) => s.name)).toEqual(['Asha']);
  });

  it('does not let a roll number get past a PIN the teacher set', async () => {
    const { roll, pc, send, add } = await lab();
    const asha = await add('Asha', '05', { pin: '1234' });
    const device = await pc();
    for (const rollNo of ['05', '5']) {
      const res = await roll(device, { rollNo });
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('PIN_REQUIRED');
    }
    // The PIN still works, on the same screen's next step.
    expect((await send('POST', '/api/v1/auth/student/pin', device, { studentId: asha.id, pin: '1234' })).statusCode).toBe(201);
  });

  it('treats 5 and 05 as the same roll number', async () => {
    const { roll, pc, add } = await lab();
    await add('Asha', '05');
    const res = await roll(await pc(), { rollNo: '5' });
    expect(res.statusCode).toBe(201);
    expect(res.json().principal.name).toBe('Asha');
  });

  it('keeps one student on one lab PC at a time', async () => {
    const { roll, pc, send, add, clock } = await lab();
    await add('Asha', '5');
    const pc1 = await pc();
    const first = (await roll(pc1, { rollNo: '5' })).json();

    const second = await roll(await pc(), { rollNo: '5' });
    expect(second.statusCode).toBe(409);
    expect(second.json()).toMatchObject({ code: 'ALREADY_SIGNED_IN', message: 'Asha is already signed in on Lab PC 1. Sign out there first.' });
    // The same PC may sign in again, e.g. after the app was closed.
    expect((await roll(pc1, { rollNo: '5' })).statusCode).toBe(201);

    // After signing out, or after ten idle minutes, another PC works.
    await send('POST', '/api/v1/auth/logout', { authorization: `Bearer ${first.token}` });
    clock.t += 11 * 60_000;
    expect((await roll(await pc(), { rollNo: '5' })).statusCode).toBe(201);
  });

  it('keeps the same roll number apart in two sections', async () => {
    const { roll, pc, send, admin, c7, add } = await lab();
    const a = (await send('POST', '/api/v1/sections', admin, { classId: c7.id, name: 'A' })).json();
    const b = (await send('POST', '/api/v1/sections', admin, { classId: c7.id, name: 'B' })).json();
    await add('Asha', '1', { sectionId: a.id });
    await add('Kabir', '1', { sectionId: b.id });

    expect((await roll(await pc(), { rollNo: '1' })).statusCode).toBe(400); // must choose a section
    expect((await roll(await pc(), { rollNo: '1', sectionId: a.id })).json().principal.name).toBe('Asha');
    expect((await roll(await pc(), { rollNo: '1', sectionId: b.id })).json().principal.name).toBe('Kabir');

    const sections = (await send('GET', `/api/v1/auth/student/sections?classId=${c7.id}`, await pc())).json();
    expect(sections.map((s: { name: string }) => s.name)).toEqual(['A', 'B']);
  });

  it('needs a lab PC that has joined the lab', async () => {
    const { roll, admin, add } = await lab();
    await add('Asha', '5');
    expect((await roll({}, { rollNo: '5' })).statusCode).toBe(401);
    expect((await roll(admin, { rollNo: '5' })).statusCode).toBe(403);
  });

  it('signs in a full class of 60 at the same moment, each on their own PC', async () => {
    const { roll, pc, send, add } = await lab();
    const pcs = [];
    for (let i = 0; i < 60; i++) {
      pcs.push(await pc());
      await add(`Student ${i + 1}`, String(i + 1));
    }

    const results = await Promise.all(pcs.map((device, i) => roll(device, { rollNo: String(i + 1) })));
    expect(results.map((r) => r.statusCode)).toEqual(Array(60).fill(201));
    expect(new Set(results.map((r) => r.json().principal.studentId)).size).toBe(60);

    // Every one of the 60 can use the app at once.
    const me = await Promise.all(results.map((r) => send('GET', '/api/v1/auth/me', { authorization: `Bearer ${r.json().token}` })));
    expect(me.map((r) => r.json().name).sort()).toEqual(results.map((_, i) => `Student ${i + 1}`).sort());
  });

  it('lets only one of two PCs in when both send the same roll number together', async () => {
    const { roll, pc, add } = await lab();
    await add('Asha', '9');
    const [a, b] = await Promise.all([roll(await pc(), { rollNo: '9' }), roll(await pc(), { rollNo: '9' })]);
    expect([a.statusCode, b.statusCode].sort()).toEqual([201, 409]);
  });
});
