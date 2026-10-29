import { describe, expect, it } from 'vitest';
import type WebSocket from 'ws';
import { testServer } from './helpers.js';

// Collects every message a socket receives, and lets a test wait for the next one of a type.
function inbox(ws: WebSocket) {
  const got: { t: string; room?: string; seq?: number; id?: string; p?: any }[] = [];
  const waiters: (() => void)[] = [];
  ws.on('message', (d) => {
    got.push(JSON.parse(d.toString()));
    waiters.splice(0).forEach((w) => w());
  });
  async function next(t: string, after = 0) {
    for (;;) {
      const hit = got.slice(after).find((m) => m.t === t);
      if (hit) return hit;
      await new Promise<void>((r) => waiters.push(r));
    }
  }
  return { got, next };
}

async function withRelay() {
  const t = await testServer();
  const token = await t.login('teacher', 'teacher-pass');
  // A test room kind: only staff may join; the snapshot echoes a counter.
  let counter = 0;
  t.c.relay.register({
    prefix: 'test',
    canJoin: (p) => p.kind === 'staff',
    snapshot: (_p, id) => ({ id, counter }),
  });
  // Listen from onInit, so the hello sent straight after connecting isn't missed.
  const open = async () => {
    let box!: ReturnType<typeof inbox>;
    const ws = await t.app.injectWS('/relay', { headers: t.auth(token) }, { onInit: (w) => { box = inbox(w); } });
    return { ws, ...box };
  };
  return { ...t, open, bump: () => { counter += 1; } };
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
});
