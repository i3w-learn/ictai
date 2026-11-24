import { describe, expect, it } from 'vitest';
import { labBooked } from '../src/modules/devices/lock-policy.js';
import { openRelay, testServer } from './helpers.js';

// 23 Nov 2026 is a Monday. Times are the Server PC's own clock.
const mon = (h: number, m: number) => new Date(2026, 10, 23, h, m);

describe('Is the lab booked right now?', () => {
  const periods = [{ id: 'p1', name: 'P1', start: '09:00', end: '09:40' }];
  const slots = [{ day: 1, periodId: 'p1' }];

  it('is booked from the first minute of the period to the minute before its end', () => {
    expect(labBooked(mon(9, 0), periods, slots)).toBe(true);
    expect(labBooked(mon(9, 39), periods, slots)).toBe(true);
    expect(labBooked(mon(9, 40), periods, slots)).toBe(false);
    expect(labBooked(mon(8, 59), periods, slots)).toBe(false);
  });

  it('is not booked on a day with no slot, or on Sunday', () => {
    expect(labBooked(new Date(2026, 10, 24, 9, 10), periods, slots)).toBe(false);
    expect(labBooked(new Date(2026, 10, 22, 9, 10), periods, slots)).toBe(false);
  });
});

// Two lab PCs and a board. Class 7 has the lab on Monday, 09:00 to 09:40.
async function lab(opts: { on?: boolean; booked?: boolean } = {}) {
  const t = await testServer();
  const admin = t.auth(await t.login('admin', 'admin-pass'));
  const teacher = t.auth(await t.login('teacher', 'teacher-pass'));
  const inject = (method: 'GET' | 'PUT' | 'POST', url: string, headers: object, payload?: object) =>
    t.app.inject({ method, url, headers: headers as Record<string, string>, ...(payload ? { payload } : {}) });
  const base = { schoolName: 'School', aiEnabled: true };
  const saved = (await inject('PUT', '/api/v1/settings', admin, { ...base, lockOutsidePeriods: opts.on ?? true, periods: [{ name: 'Period 1', start: '09:00', end: '09:40' }] })).json();
  if (opts.booked ?? true) {
    const c7 = (await inject('POST', '/api/v1/classes', admin, { name: '7' })).json();
    await inject('PUT', '/api/v1/timetable/slot', admin, { day: 1, periodId: saved.periods[0].id, classId: c7.id });
  }
  const pc1Token = await t.enrolDevice('lab_pc');
  await t.enrolDevice('lab_pc');
  await t.enrolDevice('board');
  // Moves the Server PC's clock to a time on Monday and lets the policy look.
  const tickAt = (h: number, m: number) => {
    t.clock.t = mon(h, m).getTime();
    t.c.lockPolicy.tick();
  };
  // Signs in afresh each time: the clock jumps by more than an hour, and a staff sign-in left idle that long has ended.
  const locked = async () =>
    ((await inject('GET', '/api/v1/devices', t.auth(await t.login('admin', 'admin-pass')))).json() as { name: string; locked: boolean }[]).filter((d) => d.locked).map((d) => d.name).sort();
  const switchTo = (on: boolean) => inject('PUT', '/api/v1/settings', admin, { ...saved, lockOutsidePeriods: on });
  return { ...t, admin, teacher, inject, tickAt, locked, switchTo, pc1Token };
}

describe('Locking the lab by the timetable', () => {
  it('locks the lab PCs outside a booked period and opens them inside it, leaving the board alone', async () => {
    const { tickAt, locked } = await lab();
    tickAt(8, 0);
    expect(await locked()).toEqual(['Lab PC 1', 'Lab PC 2']);
    tickAt(9, 10);
    expect(await locked()).toEqual([]);
    tickAt(9, 40);
    expect(await locked()).toEqual(['Lab PC 1', 'Lab PC 2']);
  });

  it('does nothing while the switch is off', async () => {
    const { tickAt, locked } = await lab({ on: false });
    tickAt(8, 0);
    expect(await locked()).toEqual([]);
  });

  it('does nothing when the timetable is empty, even with the switch on', async () => {
    const { tickAt, locked } = await lab({ booked: false });
    tickAt(8, 0);
    expect(await locked()).toEqual([]);
  });

  it("leaves a teacher's unlock alone until a period has started and ended", async () => {
    const { tickAt, locked, inject, teacher } = await lab();
    tickAt(8, 0);
    expect(await locked()).toEqual(['Lab PC 1', 'Lab PC 2']);
    await inject('PUT', '/api/v1/devices/lock', teacher, { locked: false });
    tickAt(8, 1);
    expect(await locked()).toEqual([]);
    tickAt(9, 10);
    expect(await locked()).toEqual([]);
    tickAt(9, 40);
    expect(await locked()).toEqual(['Lab PC 1', 'Lab PC 2']);
  });

  it('opens the PCs when the switch is turned off', async () => {
    const { tickAt, locked, switchTo } = await lab();
    tickAt(8, 0);
    expect(await locked()).toEqual(['Lab PC 1', 'Lab PC 2']);
    await switchTo(false);
    tickAt(8, 1);
    expect(await locked()).toEqual([]);
  });

  it('locks a PC that joins while the lab is locked by the policy, but not a board', async () => {
    const { tickAt, locked, enrolDevice } = await lab();
    tickAt(8, 0);
    await enrolDevice('lab_pc');
    await enrolDevice('board');
    expect(await locked()).toEqual(['Lab PC 1', 'Lab PC 2', 'Lab PC 3']);
  });

  it('does not lock a PC that joins after a teacher opened the lab by hand', async () => {
    const { tickAt, locked, enrolDevice, inject, teacher } = await lab();
    tickAt(8, 0);
    await inject('PUT', '/api/v1/devices/lock', teacher, { locked: false });
    await enrolDevice('lab_pc');
    expect(await locked()).toEqual([]);
  });

  it("does not open screens a teacher locked by hand when the switch is turned on during a class", async () => {
    const { tickAt, locked, switchTo, inject, teacher } = await lab({ on: false });
    tickAt(9, 10);
    await inject('PUT', '/api/v1/devices/lock', teacher, { locked: true });
    await switchTo(true);
    tickAt(9, 11);
    expect(await locked()).toEqual(['Lab PC 1', 'Lab PC 2']);
  });

  it('leaves a PC a teacher locked by hand alone when the switch is turned off', async () => {
    const { tickAt, locked, switchTo, inject, teacher, admin } = await lab();
    tickAt(8, 0);
    await inject('PUT', '/api/v1/devices/lock', teacher, { locked: false });
    const pc1 = ((await inject('GET', '/api/v1/devices', admin)).json() as { id: string; name: string }[]).find((d) => d.name === 'Lab PC 1')!;
    await inject('PUT', `/api/v1/devices/${pc1.id}/lock`, teacher, { locked: true });
    await switchTo(false);
    tickAt(8, 1);
    expect(await locked()).toEqual(['Lab PC 1']);
  });

  it('tells the PC whether the timetable or a teacher locked it, so the screen can say the right thing', async () => {
    const { app, auth, tickAt, inject, admin, teacher, pc1Token } = await lab();
    const pc1 = ((await inject('GET', '/api/v1/devices', admin)).json() as { id: string; name: string }[]).find((d) => d.name === 'Lab PC 1')!;
    const pc = await openRelay(app, auth(pc1Token));
    pc.ws.send(JSON.stringify({ t: 'join', room: `device:${pc1.id}` }));
    expect((await pc.next('state')).p).toEqual({ locked: false, byTimetable: false });
    const before = pc.got.length;
    tickAt(8, 0);
    expect((await pc.next('state', before)).p).toEqual({ locked: true, byTimetable: true });
    const then = pc.got.length;
    await inject('PUT', '/api/v1/devices/lock', teacher, { locked: true });
    expect((await pc.next('state', then)).p).toEqual({ locked: true, byTimetable: false });
    pc.ws.terminate();
  });

  it('writes the change in the activity log as the system', async () => {
    const { tickAt, inject, admin } = await lab();
    tickAt(8, 0);
    const log = (await inject('GET', '/api/v1/audit', admin)).json() as { action: string; actorKind: string }[];
    expect(log.find((e) => e.action === 'screens.autolock')?.actorKind).toBe('system');
  });
});
