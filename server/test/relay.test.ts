import { describe, expect, it } from 'vitest';
import { openRelay, testServer } from './helpers.js';

async function withRelay() {
  const t = await testServer();
  const token = await t.login('teacher', 'teacher-pass');
  // A test room kind: only staff may join; the snapshot echoes a counter.
  let counter = 0;
  // Stands in for a teacher losing access: only a staff member not named "Locked" may be here.
  t.c.relay.register({
    prefix: 'test',
    canJoin: (p) => p.kind === 'staff' && p.displayName !== 'Locked',
    snapshot: (_p, id) => ({ id, counter }),
  });
  const open = () => openRelay(t.app, t.auth(token));
  return { ...t, token, open, bump: () => { counter += 1; } };
}

describe('relay', () => {
  it('closes a socket that is not signed in', async () => {
    const { app } = await testServer();
    const ws = await app.injectWS('/relay');
    const code = await new Promise<number>((r) => ws.on('close', (c) => r(c)));
    expect(code).toBe(4401);
  });

  it('says hello, then answers ping with pong', async () => {
    const { open } = await withRelay();
    const { ws, next } = await open();
    expect((await next('hello')).p.serverTime).toEqual(expect.any(Number));
    ws.send(JSON.stringify({ t: 'ping', id: 'p1' }));
    expect(await next('pong')).toMatchObject({ id: 'p1', ts: expect.any(Number) });
    ws.terminate();
  });

  it('sends state on join and again on notify, with seq going up', async () => {
    const { open, c, bump } = await withRelay();
    const { ws, got, next } = await open();
    ws.send(JSON.stringify({ t: 'join', room: 'test:abc', id: 'j1' }));
    const first = await next('state');
    expect(first).toMatchObject({ room: 'test:abc', id: 'j1', p: { id: 'abc', counter: 0 } });

    const before = got.length;
    bump();
    c.relay.notify('test:abc');
    const second = await next('state', before);
    expect(second.p).toEqual({ id: 'abc', counter: 1 });
    expect(second.seq).toBeGreaterThan(first.seq!);
    ws.terminate();
  });

  it('refuses rooms it does not know or may not join', async () => {
    const { open } = await withRelay();
    const { ws, next } = await open();
    ws.send(JSON.stringify({ t: 'join', room: 'nope:1', id: 'x' }));
    expect(await next('error')).toMatchObject({ id: 'x', p: { code: 'FORBIDDEN' } });
    ws.terminate();
  });

  it('drops a bad message without closing the socket', async () => {
    const { open } = await withRelay();
    const { ws, next } = await open();
    ws.send('not json');
    expect((await next('error')).p.code).toBe('BAD_MESSAGE');
    ws.send(JSON.stringify({ t: 'ping', id: 'still-here' }));
    expect((await next('pong')).id).toBe('still-here');
    ws.terminate();
  });

  it('stops sending to a socket after leave', async () => {
    const { open, c, bump } = await withRelay();
    const { ws, got, next } = await open();
    ws.send(JSON.stringify({ t: 'join', room: 'test:abc' }));
    await next('state');
    ws.send(JSON.stringify({ t: 'leave', room: 'test:abc' }));
    ws.send(JSON.stringify({ t: 'ping', id: 'after-leave' }));
    await next('pong');
    const count = got.filter((m) => m.t === 'state').length;
    bump();
    c.relay.notify('test:abc');
    ws.send(JSON.stringify({ t: 'ping', id: 'flush' }));
    await new Promise((r) => setTimeout(r, 20));
    expect(got.filter((m) => m.t === 'state').length).toBe(count);
    ws.terminate();
  });

  // The relay looks the person up again before each update, like every REST request does,
  // so a change the Super Admin makes reaches an open socket too.
  it('drops a member from a room once they may no longer be in it', async () => {
    const { open, c, bump, app, login, auth } = await withRelay();
    const { ws, got, next } = await open();
    ws.send(JSON.stringify({ t: 'join', room: 'test:abc' }));
    await next('state');

    const admin = auth(await login('admin', 'admin-pass'));
    const staff = (await app.inject({ method: 'GET', url: '/api/v1/staff', headers: admin })).json();
    const teacher = staff.find((s: { username: string }) => s.username === 'teacher');
    await app.inject({ method: 'PATCH', url: `/api/v1/staff/${teacher.id}`, headers: admin, payload: { displayName: 'Locked' } });

    const before = got.length;
    bump();
    c.relay.notify('test:abc');
    expect(await next('error', before)).toMatchObject({ room: 'test:abc', p: { code: 'FORBIDDEN' } });
    expect(got.slice(before).filter((m) => m.t === 'state')).toEqual([]);
    ws.terminate();
  });

  it('closes the socket once the sign-in has ended', async () => {
    const { open, c, app, token, auth } = await withRelay();
    const { ws, next } = await open();
    ws.send(JSON.stringify({ t: 'join', room: 'test:abc' }));
    await next('state');
    const closed = new Promise<number>((r) => ws.on('close', (code) => r(code)));
    await app.inject({ method: 'POST', url: '/api/v1/auth/logout', headers: auth(token) });
    c.relay.notify('test:abc');
    expect(await closed).toBe(4401);
  });
});

describe('relay and sessions', () => {
  // Watching a room is not the same as using the app: a pushed update must not move the
  // session's idle timer, or a teacher who leaves a lab page open never idles out.
  it('does not count pushed state as session activity', async () => {
    const { open, c, bump, db, clock } = await withRelay();
    const { ws, got, next } = await open();
    ws.send(JSON.stringify({ t: 'join', room: 'test:abc' }));
    await next('state');
    const lastUsed = () => db.prepare("SELECT last_used_at FROM sessions WHERE kind = 'staff'").pluck().get();
    const before = lastUsed();
    clock.t += 60_000;
    const seen = got.length;
    bump();
    c.relay.notify('test:abc');
    await next('state', seen);
    expect(lastUsed()).toBe(before);
    ws.terminate();
  });
});
