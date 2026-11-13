import { describe, expect, it } from 'vitest';
import { testServer } from './helpers.js';

// Class 7 has sections A and B (Asha in A, Bina in B); Class 8 has Kabir. Ravi teaches Class 7 only.
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
    await inject('POST', '/api/v1/students', admin, { name, classId, sectionId, rollNo });
    const device = t.auth(await t.enrolDevice('lab_pc'));
    return t.auth((await inject('POST', '/api/v1/auth/student/roll', device, { classId, sectionId, rollNo })).json().token);
  };
  const asha = await student('Asha', c7.id, a.id, '1');
  const bina = await student('Bina', c7.id, b.id, '2');
  const kabir = await student('Kabir', c8.id, null, '1');
  await inject('POST', '/api/v1/staff', admin, { username: 'ravi', displayName: 'Ravi K', password: 'ravi-pass1', classIds: [c7.id], subjects: ['Maths'] });
  const ravi = t.auth(await t.login('ravi', 'ravi-pass1'));
  const post = (who: object, body: object) => inject('POST', '/api/v1/notices', who, body);
  const titles = async (who: object, url = '/api/v1/notices/mine') => (await inject('GET', url, who)).json().map((n: { title: string }) => n.title);
  return { ...t, inject, admin, ravi, c7, c8, a, b, asha, bina, kabir, post, titles };
}

describe('Notices', () => {
  it('reaches the whole school, one class, or one section, and nobody else', async () => {
    const { admin, c7, a, asha, bina, kabir, post, titles } = await school();
    expect((await post(admin, { title: 'Holiday on Friday', body: 'School is closed.' })).statusCode).toBe(201);
    await post(admin, { title: 'Class 7 trip', classId: c7.id });
    await post(admin, { title: '7 A lab today', classId: c7.id, sectionId: a.id });

    expect((await titles(asha)).sort()).toEqual(['7 A lab today', 'Class 7 trip', 'Holiday on Friday']);
    expect((await titles(bina)).sort()).toEqual(['Class 7 trip', 'Holiday on Friday']);
    expect(await titles(kabir)).toEqual(['Holiday on Friday']);
  });

  it('gives the notice back with its class, section and writer', async () => {
    const { admin, c7, a, post } = await school();
    const res = await post(admin, { title: '  Bring your notebook ', body: ' Tomorrow. ', classId: c7.id, sectionId: a.id, pinned: true });
    expect(res.json()).toMatchObject({ title: 'Bring your notebook', body: 'Tomorrow.', className: '7', sectionName: 'A', pinned: true, expired: false, expiresAt: null });
    expect(res.json().byName).toBeTruthy();
  });

  it('shows pinned notices first, then the newest', async () => {
    const { admin, asha, post, titles, clock } = await school();
    await post(admin, { title: 'Old' });
    clock.t += 1000;
    await post(admin, { title: 'Pinned', pinned: true });
    clock.t += 1000;
    await post(admin, { title: 'New' });
    expect(await titles(asha)).toEqual(['Pinned', 'New', 'Old']);
  });

  it('stops showing a notice to students when its time is up, and marks it expired for staff', async () => {
    const { admin, inject, asha, post, titles, clock } = await school();
    await post(admin, { title: 'Sports day', expiresAt: clock.t + 60_000 });
    expect(await titles(asha)).toEqual(['Sports day']);
    clock.t += 61_000;
    expect(await titles(asha)).toEqual([]);
    expect((await inject('GET', '/api/v1/notices', admin)).json()).toEqual([expect.objectContaining({ title: 'Sports day', expired: true })]);
  });

  it('refuses a notice with no title, an expiry in the past, or a section of another class', async () => {
    const { admin, c8, a, post, clock } = await school();
    expect((await post(admin, { title: '   ' })).statusCode).toBe(400);
    expect((await post(admin, { title: 'Late', expiresAt: clock.t - 1 })).statusCode).toBe(400);
    expect((await post(admin, { title: 'Wrong section', classId: c8.id, sectionId: a.id })).statusCode).toBe(400);
    expect((await post(admin, { title: 'Section, no class', sectionId: a.id })).statusCode).toBe(400);
    expect((await post(admin, { title: 'No such class', classId: '00000000-0000-4000-8000-000000000000' })).statusCode).toBe(404);
  });

  it('lets a teacher write only for her own classes', async () => {
    const { ravi, c7, c8, post } = await school();
    expect((await post(ravi, { title: 'For my class', classId: c7.id })).statusCode).toBe(201);
    expect((await post(ravi, { title: 'Not my class', classId: c8.id })).statusCode).toBe(403);
    const everyone = await post(ravi, { title: 'Whole school' });
    expect(everyone.statusCode).toBe(403);
    expect(everyone.json().message).toMatch(/Super Admin/);
  });

  it('lets a teacher read school notices but change only her own classes', async () => {
    const { admin, ravi, inject, c7, c8, post, titles } = await school();
    const whole = (await post(admin, { title: 'Whole school' })).json();
    const other = (await post(admin, { title: 'Class 8 only', classId: c8.id })).json();
    const mine = (await post(admin, { title: 'Class 7', classId: c7.id })).json();

    expect((await titles(ravi, '/api/v1/notices')).sort()).toEqual(['Class 7', 'Whole school']);
    expect((await inject('DELETE', `/api/v1/notices/${whole.id}`, ravi)).statusCode).toBe(403);
    expect((await inject('DELETE', `/api/v1/notices/${other.id}`, ravi)).statusCode).toBe(404);
    expect((await inject('PUT', `/api/v1/notices/${mine.id}`, ravi, { title: 'Class 7, changed', classId: c7.id, pinned: true })).json())
      .toMatchObject({ title: 'Class 7, changed', pinned: true });
    // She cannot move her notice to a class that is not hers, or to the whole school.
    expect((await inject('PUT', `/api/v1/notices/${mine.id}`, ravi, { title: 'x', classId: c8.id })).statusCode).toBe(403);
    expect((await inject('PUT', `/api/v1/notices/${mine.id}`, ravi, { title: 'x' })).statusCode).toBe(403);
  });

  it('takes a notice down for good', async () => {
    const { admin, inject, asha, post, titles } = await school();
    const n = (await post(admin, { title: 'Gone soon' })).json();
    expect((await inject('DELETE', `/api/v1/notices/${n.id}`, admin)).statusCode).toBe(204);
    expect(await titles(asha)).toEqual([]);
    expect((await inject('DELETE', `/api/v1/notices/${n.id}`, admin)).statusCode).toBe(404);
  });

  it('is one-way: students cannot write, change or list as staff; staff cannot use the student list', async () => {
    const { admin, inject, asha, post } = await school();
    const n = (await post(admin, { title: 'Read only' })).json();
    expect((await post(asha, { title: 'From a student' })).statusCode).toBe(403);
    expect((await inject('PUT', `/api/v1/notices/${n.id}`, asha, { title: 'Changed' })).statusCode).toBe(403);
    expect((await inject('DELETE', `/api/v1/notices/${n.id}`, asha)).statusCode).toBe(403);
    expect((await inject('GET', '/api/v1/notices', asha)).statusCode).toBe(403);
    expect((await inject('GET', '/api/v1/notices/mine', admin)).statusCode).toBe(403);
    expect((await inject('GET', '/api/v1/notices/mine', {})).statusCode).toBe(401);
  });
});
