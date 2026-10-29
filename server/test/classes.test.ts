import { describe, expect, it } from 'vitest';
import { testServer } from './helpers.js';

// Class-wide tools: duplicate check, promote, class codes, sign-in cards, and the audit log.
async function withClass() {
  const t = await testServer();
  const staff = t.auth(await t.login('teacher', 'teacher-pass'));
  const post = (url: string, payload?: object) => t.app.inject({ method: 'POST', url, headers: staff, ...(payload ? { payload } : {}) });
  const c7 = (await post('/api/v1/classes', { name: '7' })).json();
  const c8 = (await post('/api/v1/classes', { name: '8' })).json();
  const a7 = (await post('/api/v1/sections', { classId: c7.id, name: 'A' })).json();
  const b7 = (await post('/api/v1/sections', { classId: c7.id, name: 'B' })).json();
  const a8 = (await post('/api/v1/sections', { classId: c8.id, name: 'a' })).json();
  const asha = (await post('/api/v1/students', { name: 'Asha Verma', classId: c7.id, sectionId: a7.id, rollNo: '12', pin: '4321' })).json();
  const rohan = (await post('/api/v1/students', { name: 'Rohan Das', classId: c7.id, sectionId: b7.id, rollNo: '13' })).json();
  const device = t.auth(await t.enrolDevice('lab_pc'));
  return { ...t, staff, post, c7, c8, a8, asha, rohan, device };
}

describe('duplicate student check', () => {
  it('rejects the same name, class and roll number in any case', async () => {
    const { post, c7 } = await withClass();
    const res = await post('/api/v1/students', { name: 'asha verma', classId: c7.id, rollNo: '12' });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('ALREADY_EXISTS');
  });

  it('allows the same name with a different roll number or class', async () => {
    const { post, c7, c8 } = await withClass();
    expect((await post('/api/v1/students', { name: 'Asha Verma', classId: c7.id, rollNo: '40' })).statusCode).toBe(201);
    expect((await post('/api/v1/students', { name: 'Asha Verma', classId: c8.id, rollNo: '12' })).statusCode).toBe(201);
  });

  it('treats two missing roll numbers as the same', async () => {
    const { post, c7 } = await withClass();
    expect((await post('/api/v1/students', { name: 'Meera', classId: c7.id })).statusCode).toBe(201);
    expect((await post('/api/v1/students', { name: 'Meera', classId: c7.id })).statusCode).toBe(409);
  });

  it('checks edits too, but not against the student themself', async () => {
    const { app, staff, asha, rohan } = await withClass();
    const patch = (id: string, payload: object) => app.inject({ method: 'PATCH', url: `/api/v1/students/${id}`, headers: staff, payload });
    expect((await patch(rohan.id, { name: 'Asha Verma', rollNo: '12' })).statusCode).toBe(409);
    expect((await patch(asha.id, { name: 'Asha Verma' })).statusCode).toBe(200);
  });

  it('lets a deleted student be added again', async () => {
    const { app, staff, post, c7, asha } = await withClass();
    await app.inject({ method: 'DELETE', url: `/api/v1/students/${asha.id}`, headers: staff });
    expect((await post('/api/v1/students', { name: 'Asha Verma', classId: c7.id, rollNo: '12' })).statusCode).toBe(201);
  });
});

describe('promote a class', () => {
  it('moves every student and keeps sections that exist in the new class', async () => {
    const { app, staff, post, c7, c8, a8, asha } = await withClass();
    const res = await post(`/api/v1/classes/${c7.id}/promote`, { toClassId: c8.id });
    expect(res.json()).toEqual({ moved: 2 });

    const list = (await app.inject({ method: 'GET', url: `/api/v1/students?classId=${c8.id}`, headers: staff })).json();
    expect(list).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'Asha Verma', classId: c8.id, sectionId: a8.id, hasPin: true }),
      expect.objectContaining({ name: 'Rohan Das', classId: c8.id, sectionId: null }),
    ]));
    expect((await app.inject({ method: 'GET', url: `/api/v1/students?classId=${c7.id}`, headers: staff })).json()).toEqual([]);
    expect(list.find((s: { id: string }) => s.id === asha.id)).toBeTruthy();
  });

  it('refuses to promote a class into itself', async () => {
    const { post, c7 } = await withClass();
    expect((await post(`/api/v1/classes/${c7.id}/promote`, { toClassId: c7.id })).statusCode).toBe(400);
  });
});

describe('class codes and cards', () => {
  it('makes a working first sign-in code for every student', async () => {
    const { app, post, c7, device } = await withClass();
    const codes = (await post(`/api/v1/classes/${c7.id}/enrolment-codes`)).json();
    expect(codes).toHaveLength(2);
    expect(new Set(codes.map((c: { code: string }) => c.code)).size).toBe(2);
    const rohan = codes.find((c: { name: string }) => c.name === 'Rohan Das');
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/student/enrol', headers: device, payload: { code: rohan.code, pin: '2468' } });
    expect(res.statusCode).toBe(201);
  });

  it('cards carry a new QR that works, and the old QR stops working', async () => {
    const { app, c7, staff, device } = await withClass();
    const created = (await app.inject({
      method: 'POST', url: '/api/v1/students', headers: staff, payload: { name: 'Kabir', classId: c7.id, rollNo: '14' },
    })).json();
    const qr = (qrToken: string) => app.inject({ method: 'POST', url: '/api/v1/auth/student/qr', headers: device, payload: { qrToken } });
    expect((await qr(created.qrToken)).statusCode).toBe(201);

    const cards = (await app.inject({ method: 'POST', url: `/api/v1/classes/${c7.id}/cards`, headers: staff })).json();
    const kabir = cards.find((c: { name: string }) => c.name === 'Kabir');
    expect(kabir).toMatchObject({ rollNo: '14', code: expect.stringMatching(/^\d{6}$/), qrToken: expect.any(String) });
    expect((await qr(kabir.qrToken)).statusCode).toBe(201);
    expect((await qr(created.qrToken)).statusCode).toBe(401);
  });
});

describe('activity log', () => {
  it('shows who did what, newest first, with names', async () => {
    const { app, post, c7, c8, login, auth } = await withClass();
    await post(`/api/v1/classes/${c7.id}/promote`, { toClassId: c8.id });
    const admin = auth(await login('admin', 'admin-pass'));
    const log = (await app.inject({ method: 'GET', url: '/api/v1/audit', headers: admin })).json();
    expect(log[0]).toMatchObject({ actorKind: 'staff', actorName: 'admin', action: 'signin' });
    expect(log[1]).toMatchObject({ actorName: 'teacher', action: 'class.promote', targetName: '7', detail: { toClassId: c8.id, moved: 2 } });
    expect(log.map((e: { id: number }) => e.id)).toEqual([...log.map((e: { id: number }) => e.id)].sort((a, b) => b - a));
  });

  it('pages with ?before=', async () => {
    const { app, login, auth } = await withClass();
    const admin = auth(await login('admin', 'admin-pass'));
    const all = (await app.inject({ method: 'GET', url: '/api/v1/audit', headers: admin })).json();
    const older = (await app.inject({ method: 'GET', url: `/api/v1/audit?before=${all[1].id}`, headers: admin })).json();
    expect(older[0].id).toBe(all[2].id);
  });

  it('is for the Super Admin only', async () => {
    const { app, staff } = await withClass();
    expect((await app.inject({ method: 'GET', url: '/api/v1/audit', headers: staff })).statusCode).toBe(403);
  });
});
