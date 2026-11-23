import { describe, expect, it } from 'vitest';
import { openRelay, testServer } from './helpers.js';

// Two lab PCs and a board in the lab. Asha is signed in on a third lab PC.
async function lab() {
  const t = await testServer();
  const teacher = t.auth(await t.login('teacher', 'teacher-pass'));
  const admin = t.auth(await t.login('admin', 'admin-pass'));
  // Each PC joins from its own address, as on the lab network.
  let n = 0;
  const join = async (kind: 'lab_pc' | 'board') => {
    const res = await t.app.inject({ method: 'POST', url: '/api/v1/auth/device/enrol', payload: { kind, appVersion: '0.1.0' }, remoteAddress: `10.9.0.${++n}` });
    return res.json() as { deviceId: string; token: string };
  };
  const pc1 = await join('lab_pc');
  const pc2 = await join('lab_pc');
  const board = await join('board');
  const put = (who: object, url: string, locked: boolean) => t.app.inject({ method: 'PUT', url, headers: who as Record<string, string>, payload: { locked } });
  const lockOne = (who: object, id: string, locked = true) => put(who, `/api/v1/devices/${id}/lock`, locked);
  const lockAll = (who: object, locked = true) => put(who, '/api/v1/devices/lock', locked);
  const lockedNames = (list: { name: string; locked: boolean }[]) => list.filter((d) => d.locked).map((d) => d.name).sort();
  return { ...t, teacher, admin, pc1, pc2, board, lockOne, lockAll, lockedNames };
}

describe('Locking screens', () => {
  it('locks one PC and unlocks it again', async () => {
    const { teacher, pc1, lockOne, lockedNames, app } = await lab();
    const res = await lockOne(teacher, pc1.deviceId);
    expect(res.statusCode).toBe(200);
    expect(lockedNames(res.json())).toEqual(['Lab PC 1']);
    expect(lockedNames((await app.inject({ method: 'GET', url: '/api/v1/devices', headers: teacher })).json())).toEqual(['Lab PC 1']);
    expect(lockedNames((await lockOne(teacher, pc1.deviceId, false)).json())).toEqual([]);
  });

  it('locks every lab PC at once but leaves the board, and unlocks everything at once', async () => {
    const { teacher, board, lockOne, lockAll, lockedNames } = await lab();
    expect(lockedNames((await lockAll(teacher)).json())).toEqual(['Lab PC 1', 'Lab PC 2']);
    // A board is locked on its own line.
    expect(lockedNames((await lockOne(teacher, board.deviceId)).json())).toEqual(['Board 1', 'Lab PC 1', 'Lab PC 2']);
    expect(lockedNames((await lockAll(teacher, false)).json())).toEqual([]);
  });

  it('tells the PC at once, before anyone has signed in on it', async () => {
    const { app, auth, teacher, pc1, lockOne } = await lab();
    const pc = await openRelay(app, auth(pc1.token));
    pc.ws.send(JSON.stringify({ t: 'join', room: `device:${pc1.deviceId}` }));
    expect((await pc.next('state')).p).toEqual({ locked: false });
    const before = pc.got.length;
    await lockOne(teacher, pc1.deviceId);
    expect((await pc.next('state', before)).p).toEqual({ locked: true });
    const then = pc.got.length;
    await lockOne(teacher, pc1.deviceId, false);
    expect((await pc.next('state', then)).p).toEqual({ locked: false });
    pc.ws.terminate();
  });

  it('tells the student signed in on the PC, and a PC that connects late gets the lock straight away', async () => {
    const { app, auth, admin, teacher, lockAll, db, studentToken } = await lab();
    const c7 = (await app.inject({ method: 'POST', url: '/api/v1/classes', headers: admin, payload: { name: '7' } })).json();
    const asha = (await app.inject({ method: 'POST', url: '/api/v1/students', headers: admin, payload: { name: 'Asha', classId: c7.id, rollNo: '1' } })).json();
    const token = await studentToken(asha.id);
    const deviceId = db.prepare("SELECT device_id FROM sessions WHERE kind = 'student'").pluck().get() as string;

    await lockAll(teacher);
    const pc = await openRelay(app, auth(token));
    pc.ws.send(JSON.stringify({ t: 'join', room: `device:${deviceId}` }));
    expect((await pc.next('state')).p).toEqual({ locked: true });
    pc.ws.terminate();
  });

  it('does not let a PC listen to another PC, and staff do not listen at all', async () => {
    const { app, auth, teacher, pc1, pc2 } = await lab();
    const other = await openRelay(app, auth(pc2.token));
    other.ws.send(JSON.stringify({ t: 'join', room: `device:${pc1.deviceId}` }));
    expect((await other.next('error')).p.code).toBe('FORBIDDEN');
    other.ws.terminate();
    const staff = await openRelay(app, teacher);
    staff.ws.send(JSON.stringify({ t: 'join', room: `device:${pc1.deviceId}` }));
    expect((await staff.next('error')).p.code).toBe('FORBIDDEN');
    staff.ws.terminate();
  });

  it('forgets the lock of a PC that is removed from the lab', async () => {
    const { app, teacher, pc1, lockOne, lockAll, lockedNames } = await lab();
    await lockOne(teacher, pc1.deviceId);
    await app.inject({ method: 'DELETE', url: `/api/v1/devices/${pc1.deviceId}`, headers: teacher });
    expect((await lockOne(teacher, pc1.deviceId)).statusCode).toBe(404);
    expect(lockedNames((await lockAll(teacher, false)).json())).toEqual([]);
  });

  it('is for staff who may run a lesson, and writes it in the activity log', async () => {
    const { app, auth, admin, teacher, pc1, lockOne, lockAll } = await lab();
    expect((await lockOne(auth(pc1.token), pc1.deviceId)).statusCode).toBe(403);
    expect((await lockAll({})).statusCode).toBe(401);
    expect((await lockOne(teacher, '00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);

    // A teacher the Super Admin has not let host lessons cannot lock screens.
    const ravi = (await app.inject({ method: 'POST', url: '/api/v1/staff', headers: admin, payload: { username: 'ravi', displayName: 'Ravi', password: 'ravi-pass1', classIds: [(await app.inject({ method: 'POST', url: '/api/v1/classes', headers: admin, payload: { name: '8' } })).json().id], subjects: ['Maths'] } })).json();
    await app.inject({ method: 'PATCH', url: `/api/v1/staff/${ravi.id}`, headers: admin, payload: { canHostLessons: false } });
    const raviToken = (await app.inject({ method: 'POST', url: '/api/v1/auth/staff', payload: { username: 'ravi', password: 'ravi-pass1' } })).json().token;
    expect((await lockAll(auth(raviToken))).statusCode).toBe(403);

    await lockOne(teacher, pc1.deviceId);
    await lockAll(teacher, false);
    const log = (await app.inject({ method: 'GET', url: '/api/v1/audit', headers: admin })).json();
    expect(log[0]).toMatchObject({ action: 'screens.unlock', detail: { screens: 1 } });
    expect(log[1]).toMatchObject({ action: 'screen.lock', targetName: 'Lab PC 1' });
  });
});
