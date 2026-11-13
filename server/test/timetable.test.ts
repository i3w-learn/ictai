import { describe, expect, it } from 'vitest';
import { testServer } from './helpers.js';

// Two periods; Class 7 (sections A, B) and Class 8; Ravi teaches Class 7 only.
async function school() {
  const t = await testServer();
  const admin = t.auth(await t.login('admin', 'admin-pass'));
  const inject = (method: 'GET' | 'POST' | 'PUT' | 'DELETE', url: string, headers: object, payload?: object) =>
    t.app.inject({ method, url, headers: headers as Record<string, string>, ...(payload ? { payload } : {}) });
  const settings = { schoolName: 'School', aiEnabled: true };
  const [p1, p2] = (await inject('PUT', '/api/v1/settings', admin, { ...settings, periods: [{ name: 'Period 1', start: '09:00', end: '09:40' }, { name: 'Period 2', start: '09:40', end: '10:20' }] })).json().periods;
  const c7 = (await inject('POST', '/api/v1/classes', admin, { name: '7' })).json();
  const c8 = (await inject('POST', '/api/v1/classes', admin, { name: '8' })).json();
  const a = (await inject('POST', '/api/v1/sections', admin, { classId: c7.id, name: 'A' })).json();
  const b = (await inject('POST', '/api/v1/sections', admin, { classId: c7.id, name: 'B' })).json();
  await inject('POST', '/api/v1/staff', admin, { username: 'ravi', displayName: 'Ravi K', password: 'ravi-pass1', classIds: [c7.id], subjects: ['Maths'] });
  const ravi = t.auth(await t.login('ravi', 'ravi-pass1'));
  const set = (who: object, body: object) => inject('PUT', '/api/v1/timetable/slot', who, body);
  const student = async (name: string, classId: string, sectionId: string | null, rollNo: string) => {
    await inject('POST', '/api/v1/students', admin, { name, classId, sectionId, rollNo });
    const device = t.auth(await t.enrolDevice('lab_pc'));
    return t.auth((await inject('POST', '/api/v1/auth/student/roll', device, { classId, sectionId, rollNo })).json().token);
  };
  return { ...t, inject, admin, ravi, settings, p1, p2, c7, c8, a, b, set, student };
}
// 1_800_000_000_000 ms is Friday 15 January 2027, 08:00 UTC; the tests run in UTC or close to it.
const FRIDAY = 5;

describe('Timetable', () => {
  it('books the lab for a class and shows the whole grid to every staff member', async () => {
    const { inject, admin, ravi, p1, c7, a, set } = await school();
    const res = await set(admin, { day: 1, periodId: p1.id, classId: c7.id, sectionId: a.id, subject: ' Maths ' });
    expect(res.statusCode).toBe(200);
    expect(res.json().slots).toEqual([{ day: 1, periodId: p1.id, classId: c7.id, className: '7', sectionId: a.id, sectionName: 'A', subject: 'Maths' }]);
    const grid = (await inject('GET', '/api/v1/timetable', ravi)).json();
    expect(grid.periods.map((p: { name: string }) => p.name)).toEqual(['Period 1', 'Period 2']);
    expect(grid.slots).toHaveLength(1);
  });

  it('holds one class per period per day: booking again replaces, another day or period does not clash', async () => {
    const { admin, p1, p2, c7, c8, set } = await school();
    await set(admin, { day: 1, periodId: p1.id, classId: c7.id });
    await set(admin, { day: 1, periodId: p2.id, classId: c7.id });
    await set(admin, { day: 2, periodId: p1.id, classId: c8.id });
    const grid = (await set(admin, { day: 1, periodId: p1.id, classId: c8.id })).json();
    expect(grid.slots.map((s: { day: number; periodId: string; className: string }) => `${s.day}/${s.periodId === p1.id ? 1 : 2}/${s.className}`).sort())
      .toEqual(['1/1/8', '1/2/7', '2/1/8']);
  });

  it('stops a teacher taking a period another class already has, or booking a class that is not hers', async () => {
    const { inject, admin, ravi, p1, p2, c7, c8, set } = await school();
    await set(admin, { day: 1, periodId: p1.id, classId: c8.id });
    const clash = await set(ravi, { day: 1, periodId: p1.id, classId: c7.id });
    expect(clash.statusCode).toBe(409);
    expect(clash.json()).toMatchObject({ code: 'LAB_TAKEN', message: 'Class 8 has the lab on Monday in Period 1. Ask the Super Admin to change it.' });
    expect((await inject('DELETE', `/api/v1/timetable/slot?day=1&periodId=${p1.id}`, ravi)).statusCode).toBe(409);
    expect((await set(ravi, { day: 1, periodId: p2.id, classId: c8.id })).statusCode).toBe(403);
    // A free period, for her own class, is fine; and she may change or free her own booking.
    expect((await set(ravi, { day: 1, periodId: p2.id, classId: c7.id })).statusCode).toBe(200);
    expect((await inject('DELETE', `/api/v1/timetable/slot?day=1&periodId=${p2.id}`, ravi)).json().slots).toHaveLength(1);
  });

  it('refuses a day, period, class or section that does not fit', async () => {
    const { admin, p1, c7, c8, a, set } = await school();
    const none = '00000000-0000-4000-8000-000000000000';
    expect((await set(admin, { day: 7, periodId: p1.id, classId: c7.id })).statusCode).toBe(400); // Sunday
    expect((await set(admin, { day: 0, periodId: p1.id, classId: c7.id })).statusCode).toBe(400);
    expect((await set(admin, { day: 1, periodId: none, classId: c7.id })).statusCode).toBe(404);
    expect((await set(admin, { day: 1, periodId: p1.id, classId: none })).statusCode).toBe(404);
    expect((await set(admin, { day: 1, periodId: p1.id, classId: c8.id, sectionId: a.id })).statusCode).toBe(400);
  });

  it('frees a period, and forgets the bookings of a period the Super Admin deletes', async () => {
    const { inject, admin, settings, p1, p2, c7, set } = await school();
    await set(admin, { day: 1, periodId: p1.id, classId: c7.id });
    await set(admin, { day: 1, periodId: p2.id, classId: c7.id });
    expect((await inject('DELETE', `/api/v1/timetable/slot?day=1&periodId=${p1.id}`, admin)).json().slots).toHaveLength(1);
    // Period 2 is removed in Settings; Period 1 is renamed and keeps its place.
    await inject('PUT', '/api/v1/settings', admin, { ...settings, periods: [{ ...p1, name: 'First lab' }] });
    const grid = (await inject('GET', '/api/v1/timetable', admin)).json();
    expect(grid.periods).toEqual([{ ...p1, name: 'First lab' }]);
    expect(grid.slots).toEqual([]);
  });

  it("shows a student only their own class's and section's lab periods for today, in time order", async () => {
    const { inject, admin, p1, p2, c7, c8, a, b, set, student } = await school();
    await set(admin, { day: FRIDAY, periodId: p2.id, classId: c7.id, subject: 'Science' }); // whole class
    await set(admin, { day: FRIDAY, periodId: p1.id, classId: c7.id, sectionId: a.id, subject: 'Maths' }); // section A only
    await set(admin, { day: 1, periodId: p1.id, classId: c7.id }); // another day

    const today = async (who: object) => (await inject('GET', '/api/v1/timetable/today', who)).json();
    expect(await today(await student('Asha', c7.id, a.id, '1'))).toEqual({
      dayName: 'Friday',
      periods: [{ periodName: 'Period 1', start: '09:00', end: '09:40', subject: 'Maths' }, { periodName: 'Period 2', start: '09:40', end: '10:20', subject: 'Science' }],
    });
    expect((await today(await student('Bina', c7.id, b.id, '2'))).periods.map((p: { periodName: string }) => p.periodName)).toEqual(['Period 2']);
    expect((await today(await student('Kabir', c8.id, null, '1'))).periods).toEqual([]);
  });

  it('has no lab periods on a Sunday', async () => {
    const { inject, admin, auth, enrolDevice, clock, p1, c8, set } = await school();
    await inject('POST', '/api/v1/students', admin, { name: 'Kabir', classId: c8.id, rollNo: '1' });
    await set(admin, { day: 1, periodId: p1.id, classId: c8.id });
    const pc = auth(await enrolDevice('lab_pc'));
    clock.t += 2 * 24 * 3600_000; // Friday -> Sunday; the PC is still in the lab, so Kabir signs in on the day
    const kabir = auth((await inject('POST', '/api/v1/auth/student/roll', pc, { classId: c8.id, rollNo: '1' })).json().token);
    expect((await inject('GET', '/api/v1/timetable/today', kabir)).json()).toEqual({ dayName: null, periods: [] });
  });

  it('is for staff to change and students to read their own day', async () => {
    const { inject, admin, p1, c8, set, student } = await school();
    const kabir = await student('Kabir', c8.id, null, '1');
    expect((await set(kabir, { day: 1, periodId: p1.id, classId: c8.id })).statusCode).toBe(403);
    expect((await inject('GET', '/api/v1/timetable', kabir)).statusCode).toBe(403);
    expect((await inject('GET', '/api/v1/timetable/today', admin)).statusCode).toBe(403);
  });
});
