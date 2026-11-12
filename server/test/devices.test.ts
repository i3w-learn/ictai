import { describe, expect, it } from 'vitest';
import { testServer } from './helpers.js';

const enrol = () => ({
  method: 'POST' as const,
  url: '/api/v1/auth/device/enrol',
  payload: { kind: 'lab_pc', appVersion: '0.1.0' },
});
const lock = (app: Awaited<ReturnType<typeof testServer>>['app'], headers: object, open = false) =>
  app.inject({ method: 'PUT', url: '/api/v1/devices/joining', headers: headers as Record<string, string>, payload: { open } });

describe('joining the lab', () => {
  it('lets a PC join by itself, with nothing typed or pressed anywhere, and gives it a pinned cert fingerprint', async () => {
    const { app, login, auth } = await testServer();
    const res = await app.inject(enrol());
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({ name: 'Lab PC 1', certFp: 'AA:BB', serverId: expect.any(String) });

    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(body.token) });
    expect(me.json()).toMatchObject({ kind: 'device', deviceKind: 'lab_pc', name: 'Lab PC 1' });

    const list = await app.inject({ method: 'GET', url: '/api/v1/devices', headers: auth(await login('teacher', 'teacher-pass')) });
    expect(list.json()).toHaveLength(1);
  });

  it('numbers the PCs by itself, each kind on its own, even when they join together', async () => {
    const { app } = await testServer();
    // Each PC has its own address on the lab network.
    const from = (i: number, kind: string) => app.inject({ ...enrol(), payload: { kind, appVersion: '0.1.0' }, remoteAddress: `10.0.0.${i}` });
    const pcs = await Promise.all(Array.from({ length: 60 }, (_, i) => from(i + 1, 'lab_pc')));
    expect(pcs.every((r) => r.statusCode === 201)).toBe(true);
    expect(new Set(pcs.map((r) => r.json().name)).size).toBe(60);
    expect(pcs.map((r) => r.json().name)).toContain('Lab PC 60');
    expect((await from(100, 'board')).json().name).toBe('Board 1');
  });

  it('does not let a PC choose its own name', async () => {
    const { app } = await testServer();
    const res = await app.inject({ ...enrol(), payload: { kind: 'lab_pc', name: 'Server PC', appVersion: '0.1.0' } });
    expect(res.json().name).toBe('Lab PC 1');
  });

  it('refuses new PCs while staff keep the lab locked, and lets them in again when unlocked', async () => {
    const { app, login, auth } = await testServer();
    const teacher = auth(await login('teacher', 'teacher-pass'));
    const joining = async () => (await app.inject({ method: 'GET', url: '/api/v1/devices/joining', headers: teacher })).json();
    expect(await joining()).toEqual({ open: true });

    const old = (await app.inject(enrol())).json().token;
    expect((await lock(app, teacher)).json()).toEqual({ open: false });
    expect(await joining()).toEqual({ open: false });
    const refused = await app.inject(enrol());
    expect(refused.statusCode).toBe(409);
    expect(refused.json().code).toBe('ENROL_CLOSED');
    // A PC already in the lab keeps working.
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(old) })).statusCode).toBe(200);

    await lock(app, teacher, true);
    expect((await app.inject(enrol())).statusCode).toBe(201);
  });

  it('lets only staff lock or unlock the lab', async () => {
    const { app, auth } = await testServer();
    expect((await lock(app, {})).statusCode).toBe(401);
    const device = (await app.inject(enrol())).json().token;
    expect((await lock(app, auth(device))).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/v1/devices/joining', headers: auth(device) })).statusCode).toBe(403);
  });

  it('makes one address wait after it has joined five times', async () => {
    const { app } = await testServer();
    for (let i = 0; i < 5; i++) expect((await app.inject(enrol())).statusCode).toBe(201);
    expect((await app.inject(enrol())).statusCode).toBe(429);
  });

  it('lets staff remove a PC: its lab pass and its student sign-in stop working at once', async () => {
    const { app, login, auth } = await testServer();
    const admin = auth(await login('admin', 'admin-pass'));
    const pc = (await app.inject(enrol())).json();
    const cls = (await app.inject({ method: 'POST', url: '/api/v1/classes', headers: admin, payload: { name: '5' } })).json();
    await app.inject({ method: 'POST', url: '/api/v1/students', headers: admin, payload: { name: 'Asha', classId: cls.id, rollNo: '1' } });
    const student = (await app.inject({ method: 'POST', url: '/api/v1/auth/student/roll', headers: auth(pc.token), payload: { classId: cls.id, rollNo: '1' } })).json();
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(student.token) })).statusCode).toBe(200);

    expect((await app.inject({ method: 'DELETE', url: `/api/v1/devices/${pc.deviceId}`, headers: auth(pc.token) })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/devices/${pc.deviceId}`, headers: admin })).statusCode).toBe(204);

    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(pc.token) })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(student.token) })).statusCode).toBe(401);
    expect((await app.inject({ method: 'GET', url: '/api/v1/devices', headers: admin })).json()).toEqual([]);
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/devices/${pc.deviceId}`, headers: admin })).statusCode).toBe(404);
  });

  it('expires a device token after 90 unused days, and renews it while in use', async () => {
    const { app, clock, login, auth } = await testServer();
    const token = await login('admin', 'admin-pass');
    const device = (await app.inject(enrol())).json().token;
    const day = 24 * 3600_000;

    clock.t += 60 * day; // used on day 60: renewed to day 150
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(device) })).statusCode).toBe(200);
    clock.t += 85 * day; // day 145: still valid thanks to renewal
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(device) })).statusCode).toBe(200);
    clock.t += 91 * day; // unused for 91 days
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(device) })).statusCode).toBe(401);
  });
});

describe('the connection table', () => {
  async function lab() {
    const t = await testServer();
    const admin = t.auth(await t.login('admin', 'admin-pass'));
    const pc = t.auth(await t.enrolDevice('lab_pc'));
    const list = async (who = admin) => (await t.app.inject({ method: 'GET', url: '/api/v1/devices', headers: who })).json();
    const ping = (who: object) => t.app.inject({ method: 'POST', url: '/api/v1/devices/ping', headers: who as Record<string, string> });
    return { ...t, admin, pc, list, ping };
  }

  it('shows a PC as connected while it keeps pinging, and not connected once it stops', async () => {
    const { clock, pc, list, ping } = await lab();
    expect(await list()).toEqual([expect.objectContaining({ name: 'Lab PC 1', connected: true, student: null })]);

    clock.t += 46_000;
    expect((await list())[0].connected).toBe(false);

    expect((await ping(pc)).statusCode).toBe(204);
    expect((await list())[0].connected).toBe(true);
    clock.t += 44_000;
    expect((await list())[0].connected).toBe(true);
  });

  it('takes a ping only from an enrolled device', async () => {
    const { admin, ping } = await lab();
    expect((await ping({})).statusCode).toBe(401);
    expect((await ping(admin)).statusCode).toBe(403);
  });

  it('shows who is signed in on each PC, until they sign out', async () => {
    const { app, admin, pc, list } = await lab();
    const c7 = (await app.inject({ method: 'POST', url: '/api/v1/classes', headers: admin, payload: { name: '7' } })).json();
    await app.inject({ method: 'POST', url: '/api/v1/students', headers: admin, payload: { name: 'Asha', classId: c7.id, rollNo: '4' } });
    const session = (await app.inject({ method: 'POST', url: '/api/v1/auth/student/roll', headers: pc, payload: { classId: c7.id, rollNo: '4' } })).json();
    expect((await list())[0].student).toEqual({ name: 'Asha', className: '7' });

    await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: { authorization: `Bearer ${session.token}` } });
    expect((await list())[0].student).toBeNull();
  });

  it('lets a teacher see the table, but not the name of a student from a class they do not teach', async () => {
    const { app, admin, pc, list, login, auth } = await lab();
    const c7 = (await app.inject({ method: 'POST', url: '/api/v1/classes', headers: admin, payload: { name: '7' } })).json();
    const c8 = (await app.inject({ method: 'POST', url: '/api/v1/classes', headers: admin, payload: { name: '8' } })).json();
    await app.inject({ method: 'POST', url: '/api/v1/students', headers: admin, payload: { name: 'Asha', classId: c7.id, rollNo: '4' } });
    await app.inject({ method: 'POST', url: '/api/v1/auth/student/roll', headers: pc, payload: { classId: c7.id, rollNo: '4' } });
    const teacher = auth(await login('teacher', 'teacher-pass'));
    expect((await list(teacher))[0]).toMatchObject({ connected: true, student: { name: 'Asha', className: '7' } });

    const staff = (await app.inject({ method: 'GET', url: '/api/v1/staff', headers: admin })).json();
    const id = staff.find((s: { username: string }) => s.username === 'teacher').id;
    const set = await app.inject({ method: 'PATCH', url: `/api/v1/staff/${id}`, headers: admin, payload: { classIds: [c8.id] } });
    expect(set.statusCode).toBe(200);
    expect((await list(teacher))[0].student).toEqual({ name: null, className: '7' });
  });
});
