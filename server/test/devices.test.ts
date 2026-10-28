import { describe, expect, it } from 'vitest';
import { testServer } from './helpers.js';

const enrol = (code: string) => ({
  method: 'POST' as const,
  url: '/api/v1/auth/device/enrol',
  payload: { code, kind: 'lab_pc', name: 'LAB-PC-01', appVersion: '0.1.0' },
});

describe('device enrolment', () => {
  it('needs a signed-in staff member with setup.devices to open a window', async () => {
    const { app } = await testServer();
    const res = await app.inject({ method: 'POST', url: '/api/v1/devices/enrol-window', payload: {} });
    expect(res.statusCode).toBe(401);
  });

  it('refuses when no window is open', async () => {
    const { app } = await testServer();
    const res = await app.inject(enrol('123456'));
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('ENROL_CLOSED');
  });

  it('enrols a device with the right code and gives it a pinned cert fingerprint', async () => {
    const { app, login, auth } = await testServer();
    const token = await login('teacher', 'teacher-pass');
    const win = await app.inject({ method: 'POST', url: '/api/v1/devices/enrol-window', headers: auth(token), payload: { minutes: 30 } });
    expect(win.statusCode).toBe(201);
    const { code } = win.json();

    const res = await app.inject(enrol(code));
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({ certFp: 'AA:BB', serverId: expect.any(String) });

    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(body.token) });
    expect(me.json()).toMatchObject({ kind: 'device', deviceKind: 'lab_pc', name: 'LAB-PC-01' });

    const list = await app.inject({ method: 'GET', url: '/api/v1/devices', headers: auth(token) });
    expect(list.json()).toHaveLength(1);
  });

  it('closes the window after its time is up', async () => {
    const { app, clock, login, auth } = await testServer();
    const token = await login('admin', 'admin-pass');
    const { code } = (await app.inject({ method: 'POST', url: '/api/v1/devices/enrol-window', headers: auth(token), payload: { minutes: 1 } })).json();
    clock.t += 61_000;
    expect((await app.inject(enrol(code))).statusCode).toBe(409);
  });

  it('blocks code guessing after 5 wrong codes', async () => {
    const { app, login, auth } = await testServer();
    const token = await login('admin', 'admin-pass');
    const { code } = (await app.inject({ method: 'POST', url: '/api/v1/devices/enrol-window', headers: auth(token), payload: {} })).json();
    const wrong = code === '000000' ? '000001' : '000000';
    for (let i = 0; i < 5; i++) expect((await app.inject(enrol(wrong))).statusCode).toBe(403);
    expect((await app.inject(enrol(code))).statusCode).toBe(429);
  });

  it('does not let a device open an enrol window', async () => {
    const { app, login, auth } = await testServer();
    const token = await login('admin', 'admin-pass');
    const { code } = (await app.inject({ method: 'POST', url: '/api/v1/devices/enrol-window', headers: auth(token), payload: {} })).json();
    const device = (await app.inject(enrol(code))).json().token;
    const res = await app.inject({ method: 'POST', url: '/api/v1/devices/enrol-window', headers: auth(device), payload: {} });
    expect(res.statusCode).toBe(403);
  });

  it('expires a device token after 90 unused days, and renews it while in use', async () => {
    const { app, clock, login, auth } = await testServer();
    const token = await login('admin', 'admin-pass');
    const { code } = (await app.inject({ method: 'POST', url: '/api/v1/devices/enrol-window', headers: auth(token), payload: {} })).json();
    const device = (await app.inject(enrol(code))).json().token;
    const day = 24 * 3600_000;

    clock.t += 60 * day; // used on day 60: renewed to day 150
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(device) })).statusCode).toBe(200);
    clock.t += 85 * day; // day 145: still valid thanks to renewal
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(device) })).statusCode).toBe(200);
    clock.t += 91 * day; // unused for 91 days
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(device) })).statusCode).toBe(401);
  });
});
