import { describe, expect, it } from 'vitest';
import { testServer } from './helpers.js';

const PRIYA = { username: 'priya', displayName: 'Priya S', password: 'priya-pass' };

async function withAdmin() {
  const t = await testServer();
  const admin = t.auth(await t.login('admin', 'admin-pass'));
  const add = (payload: object = PRIYA) => t.app.inject({ method: 'POST', url: '/api/v1/staff', headers: admin, payload });
  const me = (token: string) => t.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: t.auth(token) });
  return { ...t, admin, add, me };
}

describe('staff management (Super Admin)', () => {
  it('adds a teacher who can then sign in', async () => {
    const { add, login } = await withAdmin();
    const res = await add();
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ username: 'priya', displayName: 'Priya S', role: 'teacher', canHostLessons: true, status: 'active' });
    expect(JSON.stringify(res.json())).not.toMatch(/hash|priya-pass/);
    expect(await login('priya', 'priya-pass')).toEqual(expect.any(String));
  });

  it('rejects a duplicate username in any case', async () => {
    const { add } = await withAdmin();
    await add();
    const again = await add({ ...PRIYA, username: 'Priya' });
    expect(again.statusCode).toBe(409);
    expect(again.json().code).toBe('ALREADY_EXISTS');
  });

  it('rejects a short password', async () => {
    const { add } = await withAdmin();
    expect((await add({ ...PRIYA, password: 'short' })).statusCode).toBe(400);
  });

  it('a teacher cannot manage staff', async () => {
    const { app, login, auth } = await withAdmin();
    const teacher = auth(await login('teacher', 'teacher-pass'));
    expect((await app.inject({ method: 'GET', url: '/api/v1/staff', headers: teacher })).statusCode).toBe(403);
  });

  it('switches apply on the next request', async () => {
    const { app, admin, add, login, me } = await withAdmin();
    const { id } = (await add()).json();
    const token = await login('priya', 'priya-pass');
    const res = await app.inject({ method: 'PATCH', url: `/api/v1/staff/${id}`, headers: admin, payload: { canHostLessons: false } });
    expect(res.json()).toMatchObject({ canHostLessons: false, canUploadContent: true });
    expect((await me(token)).json().permissions).not.toContain('lesson.start');
  });

  it("ends a disabled teacher's session at once", async () => {
    const { app, admin, add, login, me } = await withAdmin();
    const { id } = (await add()).json();
    const token = await login('priya', 'priya-pass');
    await app.inject({ method: 'PATCH', url: `/api/v1/staff/${id}`, headers: admin, payload: { status: 'disabled' } });
    expect((await me(token)).statusCode).toBe(401);
    expect(await login('priya', 'priya-pass')).toBeUndefined();

    await app.inject({ method: 'PATCH', url: `/api/v1/staff/${id}`, headers: admin, payload: { status: 'active' } });
    expect(await login('priya', 'priya-pass')).toEqual(expect.any(String));
  });

  it('password reset ends old sessions', async () => {
    const { app, admin, add, login, me } = await withAdmin();
    const { id } = (await add()).json();
    const token = await login('priya', 'priya-pass');
    const res = await app.inject({ method: 'PUT', url: `/api/v1/staff/${id}/password`, headers: admin, payload: { password: 'new-pass-123' } });
    expect(res.statusCode).toBe(204);
    expect((await me(token)).statusCode).toBe(401);
    expect(await login('priya', 'new-pass-123')).toEqual(expect.any(String));
  });

  it('deletes a teacher', async () => {
    const { app, admin, add, login, me } = await withAdmin();
    const { id } = (await add()).json();
    const token = await login('priya', 'priya-pass');
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/staff/${id}`, headers: admin })).statusCode).toBe(204);
    const list = (await app.inject({ method: 'GET', url: '/api/v1/staff', headers: admin })).json();
    expect(list.map((s: { username: string }) => s.username)).not.toContain('priya');
    expect((await me(token)).statusCode).toBe(401);
  });

  it('cannot touch a super admin', async () => {
    const { app, admin } = await withAdmin();
    const list = (await app.inject({ method: 'GET', url: '/api/v1/staff', headers: admin })).json();
    const { id } = list.find((s: { role: string }) => s.role === 'super_admin');
    const url = `/api/v1/staff/${id}`;
    expect((await app.inject({ method: 'PATCH', url, headers: admin, payload: { status: 'disabled' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'PUT', url: `${url}/password`, headers: admin, payload: { password: 'whatever-123' } })).statusCode).toBe(403);
    expect((await app.inject({ method: 'DELETE', url, headers: admin })).statusCode).toBe(403);
  });
});
