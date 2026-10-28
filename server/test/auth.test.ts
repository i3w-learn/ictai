import { describe, expect, it } from 'vitest';
import { testServer } from './helpers.js';

describe('health', () => {
  it('reports the server identity without auth', async () => {
    const { app } = await testServer();
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, schoolId: null, activated: false });
    expect(res.json().serverId).toMatch(/^[0-9a-f-]{36}$/);
  });
});

describe('staff sign-in', () => {
  it('rejects a wrong password with { code, message }', async () => {
    const { app } = await testServer();
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/staff', payload: { username: 'admin', password: 'nope' } });
    expect(res.statusCode).toBe(401);
    expect(res.json()).toEqual({ code: 'INVALID_CREDENTIALS', message: expect.any(String) });
  });

  it('rejects a bad body', async () => {
    const { app } = await testServer();
    const res = await app.inject({ method: 'POST', url: '/api/v1/auth/staff', payload: { username: '' } });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('BAD_REQUEST');
  });

  it('signs in, returns permissions, and logs out', async () => {
    const { app, login, auth } = await testServer();
    const token = await login('admin', 'admin-pass');
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(token) });
    expect(me.json()).toMatchObject({ kind: 'staff', role: 'super_admin', username: 'admin' });
    expect(me.json().permissions).toContain('server.manage');

    const out = await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: auth(token) });
    expect(out.statusCode).toBe(204);
    const again = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(token) });
    expect(again.statusCode).toBe(401);
  });

  it('does not accept the token in the URL', async () => {
    const { app, login } = await testServer();
    const token = await login('admin', 'admin-pass');
    const res = await app.inject({ method: 'GET', url: `/api/v1/auth/me?token=${token}` });
    expect(res.statusCode).toBe(401);
  });

  it('ends the session after 15 minutes idle', async () => {
    const { app, clock, login, auth } = await testServer();
    const token = await login('teacher', 'teacher-pass');
    clock.t += 14 * 60_000;
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(token) })).statusCode).toBe(200);
    clock.t += 14 * 60_000; // still active: last use reset the idle timer
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(token) })).statusCode).toBe(200);
    clock.t += 16 * 60_000;
    expect((await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(token) })).statusCode).toBe(401);
  });

  it('locks out after 5 wrong tries for 5 minutes', async () => {
    const { app, clock } = await testServer();
    const bad = { method: 'POST' as const, url: '/api/v1/auth/staff', payload: { username: 'teacher', password: 'x' } };
    for (let i = 0; i < 5; i++) expect((await app.inject(bad)).statusCode).toBe(401);
    const good = { ...bad, payload: { username: 'teacher', password: 'teacher-pass' } };
    expect((await app.inject(good)).statusCode).toBe(429);
    clock.t += 5 * 60_000 + 1;
    expect((await app.inject(good)).statusCode).toBe(201);
  });

  it('applies a teacher permission switch on the next request', async () => {
    const { app, db, login, auth } = await testServer();
    const token = await login('teacher', 'teacher-pass');
    db.prepare(`UPDATE users SET can_host_lessons = 0 WHERE username = 'teacher'`).run();
    const me = await app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: auth(token) });
    expect(me.json().permissions).not.toContain('lesson.start');
    expect(me.json().permissions).not.toContain('staff.manage');
  });
});
