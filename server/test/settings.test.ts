import { describe, expect, it } from 'vitest';
import { testServer } from './helpers.js';

async function setup() {
  const t = await testServer({ ai: { llm: { json: () => new Promise(() => {}) }, installed: true } });
  const admin = t.auth(await t.login('admin', 'admin-pass'));
  const teacher = t.auth(await t.login('teacher', 'teacher-pass'));
  const inject = (method: 'GET' | 'POST' | 'PUT', url: string, headers: object, payload?: object) =>
    t.app.inject({ method, url, headers: headers as Record<string, string>, ...(payload ? { payload } : {}) });
  const base = { schoolName: 'ZP School Walni', aiEnabled: true, periods: [] as object[] };
  const student = async () => {
    const c7 = (await inject('POST', '/api/v1/classes', admin, { name: '7' })).json();
    await inject('POST', '/api/v1/students', admin, { name: 'Asha', classId: c7.id, rollNo: '1' });
    const device = t.auth(await t.enrolDevice('lab_pc'));
    return t.auth((await inject('POST', '/api/v1/auth/student/roll', device, { classId: c7.id, rollNo: '1' })).json().token);
  };
  return { ...t, inject, admin, teacher, base, student };
}

describe('School settings', () => {
  it('starts with AI on and no periods, and any staff member can read them', async () => {
    const { inject, teacher } = await setup();
    expect((await inject('GET', '/api/v1/settings', teacher)).json()).toEqual({ schoolName: 'ICT Lab Server', aiEnabled: true, periods: [] });
  });

  it('gives each period a lasting id that survives a rename', async () => {
    const { inject, admin, base } = await setup();
    const first = (await inject('PUT', '/api/v1/settings', admin, { ...base, periods: [{ name: 'Period 1', start: '09:00', end: '09:40' }] })).json().periods[0];
    expect(first.id).toEqual(expect.any(String));
    const renamed = (await inject('PUT', '/api/v1/settings', admin, { ...base, periods: [{ ...first, name: 'Lab 1', start: '09:05' }] })).json().periods;
    expect(renamed).toEqual([{ id: first.id, name: 'Lab 1', start: '09:05', end: '09:40' }]);
  });

  it('lets only the Super Admin change them', async () => {
    const { inject, admin, teacher, base, student } = await setup();
    expect((await inject('PUT', '/api/v1/settings', teacher, base)).statusCode).toBe(403);
    expect((await inject('PUT', '/api/v1/settings', await student(), base)).statusCode).toBe(403);
    expect((await inject('PUT', '/api/v1/settings', {}, base)).statusCode).toBe(401);
    expect((await inject('PUT', '/api/v1/settings', admin, base)).statusCode).toBe(200);
  });

  it('saves the school name and shows it to PCs looking for the server', async () => {
    const { inject, admin, base } = await setup();
    await inject('PUT', '/api/v1/settings', admin, { ...base, schoolName: '  ZP School Walni ' });
    expect((await inject('GET', '/health', {})).json().name).toBe('ZP School Walni');
    expect((await inject('PUT', '/api/v1/settings', admin, { ...base, schoolName: '  ' })).statusCode).toBe(400);
  });

  it('keeps the periods in time order and refuses ones that overlap or share a name', async () => {
    const { inject, admin, base } = await setup();
    const p = (name: string, start: string, end: string) => ({ name, start, end });
    const saved = await inject('PUT', '/api/v1/settings', admin, { ...base, periods: [p('Period 2', '09:40', '10:20'), p('Period 1', '09:00', '09:40')] });
    expect(saved.json().periods.map((x: { name: string }) => x.name)).toEqual(['Period 1', 'Period 2']);

    const overlap = await inject('PUT', '/api/v1/settings', admin, { ...base, periods: [p('Period 1', '09:00', '09:40'), p('Period 2', '09:30', '10:10')] });
    expect(overlap.statusCode).toBe(400);
    expect(overlap.json().message).toMatch(/Period 1.*Period 2.*overlap/);
    expect((await inject('PUT', '/api/v1/settings', admin, { ...base, periods: [p('Lab', '09:00', '09:40'), p('lab', '10:00', '10:40')] })).statusCode).toBe(400);
    expect((await inject('PUT', '/api/v1/settings', admin, { ...base, periods: [p('Backwards', '10:00', '09:00')] })).statusCode).toBe(400);
    expect((await inject('PUT', '/api/v1/settings', admin, { ...base, periods: [p('Bad time', '9am', '10:00')] })).statusCode).toBe(400);
    // A refused save changes nothing.
    expect((await inject('GET', '/api/v1/settings', admin)).json().periods).toHaveLength(2);
  });

  it('switches AI off for everyone at once, and on again', async () => {
    const { inject, admin, teacher, base } = await setup();
    await inject('PUT', '/api/v1/settings', admin, { ...base, aiEnabled: false });
    expect((await inject('GET', '/api/v1/ai/status', teacher)).json()).toMatchObject({ enabled: false, installed: true });
    const off = await inject('POST', '/api/v1/ai/ask', teacher, { question: 'Why is the sky blue?' });
    expect(off.statusCode).toBe(403);
    expect(off.json()).toMatchObject({ code: 'AI_OFF' });

    await inject('PUT', '/api/v1/settings', admin, { ...base, aiEnabled: true });
    expect((await inject('POST', '/api/v1/ai/ask', teacher, { question: 'Why is the sky blue?' })).statusCode).toBe(202);
  });
});

describe('Student screen settings', () => {
  it('start plain, are saved, and follow the student to another PC', async () => {
    const { inject, admin, student, enrolDevice, auth } = await setup();
    const asha = await student();
    expect((await inject('GET', '/api/v1/me/prefs', asha)).json()).toEqual({ textSize: 'normal', highContrast: false, easyFont: false });

    const saved = await inject('PUT', '/api/v1/me/prefs', asha, { textSize: 'xlarge', highContrast: true, easyFont: true });
    expect(saved.json()).toEqual({ textSize: 'xlarge', highContrast: true, easyFont: true });

    // Sign out, then sign in on a different lab PC.
    await inject('POST', '/api/v1/auth/logout', asha);
    const c7 = (await inject('GET', '/api/v1/classes', admin)).json()[0];
    const again = auth((await inject('POST', '/api/v1/auth/student/roll', auth(await enrolDevice('lab_pc')), { classId: c7.id, rollNo: '1' })).json().token);
    expect((await inject('GET', '/api/v1/me/prefs', again)).json()).toEqual({ textSize: 'xlarge', highContrast: true, easyFont: true });
  });

  it('refuses a size that does not exist, and is for students only', async () => {
    const { inject, admin, student } = await setup();
    const asha = await student();
    expect((await inject('PUT', '/api/v1/me/prefs', asha, { textSize: 'huge' })).statusCode).toBe(400);
    expect((await inject('GET', '/api/v1/me/prefs', admin)).statusCode).toBe(403);
  });
});
