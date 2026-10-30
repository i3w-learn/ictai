import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Platform, RelayEvent } from '../platform/platform';
import { RelayClient } from './relay-client';
import type { ServerTarget } from './settings';

const TARGET: ServerTarget = { serverId: 's', name: 'Lab', certFp: 'AA', addr: '10.0.0.5', port: 7700 };

// A fake relay: records what was sent, lets a test fail the next opens, push messages, or drop the socket.
function fakeRelay() {
  let listener: ((e: RelayEvent) => void) | null = null;
  let conn = 0;
  let failNext = 0;
  const sent: { t: string; room?: string }[] = [];
  const opens: string[] = [];
  const platform = {
    relayOpen: async (base: string) => {
      opens.push(base);
      if (failNext > 0) {
        failNext -= 1;
        throw new Error('unreachable');
      }
      return ++conn;
    },
    relaySend: async (text: string) => { sent.push(JSON.parse(text)); },
    relayClose: async () => undefined,
    onRelay: (fn: (e: RelayEvent) => void) => { listener = fn; return () => { if (listener === fn) listener = null; }; },
  } as unknown as Platform;
  return {
    platform, sent, opens,
    failOpens: (n: number) => { failNext = n; },
    push: (msg: object) => listener?.({ kind: 'message', conn, text: JSON.stringify({ ts: 1, ...msg }) }),
    drop: (code: number | null = null, which = conn) => listener?.({ kind: 'closed', conn: which, code, reason: 'gone' }),
  };
}

const flush = () => vi.advanceTimersByTimeAsync(0);
const attached = (r: RelayClient) => { r.attach(); return r; };

describe('RelayClient', () => {
  // React StrictMode mounts, unmounts and mounts again in development. The client must
  // still hear the relay after that, or it looks online but never gets a message.
  it('keeps receiving after detach and attach again', async () => {
    const f = fakeRelay();
    const relay = new RelayClient(f.platform, () => TARGET);
    relay.attach();
    relay.detach();
    relay.attach();
    relay.connect('tok');
    await flush();
    const seen: unknown[] = [];
    relay.subscribe('quiz:1', (s) => seen.push(s));
    f.push({ t: 'state', room: 'quiz:1', p: { n: 1 } });
    expect(seen).toEqual([{ n: 1 }]);
  });

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('joins a room on subscribe and hands over its state', async () => {
    const f = fakeRelay();
    const relay = attached(new RelayClient(f.platform, () => TARGET));
    relay.connect('tok');
    await flush();
    expect(f.opens).toEqual(['https://10.0.0.5:7700']);
    expect(relay.getStatus()).toBe('online');

    const seen: unknown[] = [];
    relay.subscribe('quiz:1', (s) => seen.push(s));
    await flush();
    expect(f.sent).toContainEqual({ t: 'join', room: 'quiz:1' });

    f.push({ t: 'state', room: 'quiz:1', p: { n: 1 } });
    f.push({ t: 'state', room: 'quiz:2', p: { n: 99 } });
    expect(seen).toEqual([{ n: 1 }]);
  });

  it('rejoins rooms after reconnect, waiting 1 s then 2 s', async () => {
    const f = fakeRelay();
    const relay = attached(new RelayClient(f.platform, () => TARGET));
    relay.connect('tok');
    await flush();
    relay.subscribe('quiz:1', () => {});
    await flush();
    f.sent.length = 0;

    f.failOpens(1);
    f.drop();
    expect(relay.getStatus()).toBe('reconnecting');
    await vi.advanceTimersByTimeAsync(999);
    expect(f.opens).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1); // 1 s: first retry fails
    expect(f.opens).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1999);
    expect(f.opens).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(1); // 2 s later: second retry works
    expect(f.opens).toHaveLength(3);
    expect(relay.getStatus()).toBe('online');
    expect(f.sent).toEqual([{ t: 'join', room: 'quiz:1' }]);
  });

  it('never waits more than 30 s between tries', async () => {
    const f = fakeRelay();
    const relay = attached(new RelayClient(f.platform, () => TARGET));
    f.failOpens(100);
    relay.connect('tok');
    await vi.advanceTimersByTimeAsync((1 + 2 + 4 + 8 + 16 + 30) * 1000);
    const before = f.opens.length;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.opens.length).toBe(before + 1);
  });

  it('reconnects when pings get no pong', async () => {
    const f = fakeRelay();
    const relay = attached(new RelayClient(f.platform, () => TARGET));
    relay.connect('tok');
    await flush();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(f.sent).toContainEqual({ t: 'ping' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(relay.getStatus()).toBe('reconnecting');
  });

  it('stays connected while pongs come back', async () => {
    const f = fakeRelay();
    const relay = attached(new RelayClient(f.platform, () => TARGET));
    relay.connect('tok');
    await flush();
    await vi.advanceTimersByTimeAsync(20_000);
    f.push({ t: 'pong' });
    await vi.advanceTimersByTimeAsync(10_000);
    expect(relay.getStatus()).toBe('online');
  });

  it('stops and reports sign-out when the server says the token is gone', async () => {
    const f = fakeRelay();
    const signedOut = vi.fn();
    const relay = attached(new RelayClient(f.platform, () => TARGET, signedOut));
    relay.connect('tok');
    await flush();
    f.drop(4401);
    expect(signedOut).toHaveBeenCalledOnce();
    expect(relay.getStatus()).toBe('off');
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.opens).toHaveLength(1);
  });

  it('leaves a room after the last subscriber goes', async () => {
    const f = fakeRelay();
    const relay = attached(new RelayClient(f.platform, () => TARGET));
    relay.connect('tok');
    await flush();
    const a = relay.subscribe('quiz:1', () => {});
    const b = relay.subscribe('quiz:1', () => {});
    a();
    expect(f.sent.filter((m) => m.t === 'leave')).toHaveLength(0);
    b();
    await flush();
    expect(f.sent).toContainEqual({ t: 'leave', room: 'quiz:1' });
  });

  it('ignores events from a socket it already replaced', async () => {
    const f = fakeRelay();
    const relay = attached(new RelayClient(f.platform, () => TARGET));
    relay.connect('tok');
    await flush();
    f.drop(); // socket 1 dropped → retry in 1 s
    await vi.advanceTimersByTimeAsync(1000);
    expect(relay.getStatus()).toBe('online'); // now on socket 2
    f.drop(null, 1); // a late "closed" for socket 1
    expect(relay.getStatus()).toBe('online');
  });
});
