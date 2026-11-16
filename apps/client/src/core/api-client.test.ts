import { describe, expect, it } from 'vitest';
import { PlatformError, type FoundServer, type Platform, type RawRequest, type RawResponse } from '../platform/platform';
import { ApiCallError, ApiClient, buildPath } from './api-client';
import { ServerLocator } from './server-locator';
import type { ServerTarget } from './settings';

const HEALTH = { ok: true, serverId: 'srv-1', schoolId: null, name: 'Lab', activated: false, version: '0.1.0' };

// A fake network: servers live at addresses; anything else is unreachable.
function fakePlatform(opts: { up: Record<string, (r: RawRequest) => RawResponse>; found?: FoundServer[] }) {
  const calls: string[] = [];
  const platform: Platform = {
    appVersion: 'test',
    discover: async () => opts.found ?? [],
    request: async (r) => {
      calls.push(`${r.method} ${r.baseUrl}${r.path}`);
      const host = new URL(r.baseUrl).hostname;
      const handler = opts.up[host];
      if (!handler) throw new PlatformError('network', 'unreachable');
      return handler(r);
    },
    probe: async () => ({ certFp: 'AA', health: HEALTH }),
    loadSettings: async () => null,
    saveSettings: async () => undefined,
    clearSettings: async () => undefined,
    installRole: async () => null,
    relayOpen: async () => 1,
    relaySend: async () => undefined,
    relayClose: async () => undefined,
    onRelay: () => () => {},
  };
  return { platform, calls };
}

function client(platform: Platform, start: ServerTarget) {
  let target: ServerTarget | null = start;
  const api = new ApiClient(platform, new ServerLocator(platform, 'student'), { get: () => target, set: (t) => (target = t) });
  return { api, target: () => target };
}

const saved: ServerTarget = { serverId: 'srv-1', name: 'Lab', certFp: 'AA', addr: '192.168.1.20', port: 7700 };

describe('buildPath', () => {
  it('fills params and adds the query', () => {
    expect(buildPath('/api/v1/students/:id/pin', { id: 'a b' })).toBe('/api/v1/students/a%20b/pin');
    expect(buildPath('/api/v1/students', undefined, { classId: 'c1' })).toBe('/api/v1/students?classId=c1');
  });
});

describe('ApiClient', () => {
  it('parses a successful response with the contract schema', async () => {
    const { platform } = fakePlatform({ up: { '192.168.1.20': () => ({ status: 200, body: HEALTH }) } });
    const { api } = client(platform, saved);
    await expect(api.call('GET /health')).resolves.toEqual(HEALTH);
  });

  it('turns { code, message } into an ApiCallError', async () => {
    const { platform } = fakePlatform({
      up: { '192.168.1.20': () => ({ status: 401, body: { code: 'INVALID_CREDENTIALS', message: 'Wrong username or password.' } }) },
    });
    const { api } = client(platform, saved);
    const err = await api.call('POST /api/v1/auth/staff', { body: { username: 'a', password: 'b' } }).catch((e) => e);
    expect(err).toBeInstanceOf(ApiCallError);
    expect(err).toMatchObject({ status: 401, code: 'INVALID_CREDENTIALS' });
  });

  it('checks the body against the contract before sending', async () => {
    const { platform, calls } = fakePlatform({ up: {} });
    const { api } = client(platform, saved);
    await expect(api.call('POST /api/v1/auth/staff', { body: { username: '', password: 'x' } })).rejects.toThrow();
    expect(calls).toEqual([]);
  });

  it('finds the server again by its ID when the saved address stops answering', async () => {
    const found: FoundServer = { serverId: 'srv-1', schoolId: null, name: 'Lab', addrs: ['10.0.0.9'], port: 7700, certFp: 'AA', from: '10.0.0.9' };
    const { platform } = fakePlatform({ up: { '10.0.0.9': () => ({ status: 200, body: HEALTH }) }, found: [found] });
    const { api, target } = client(platform, saved);
    await expect(api.call('GET /health')).resolves.toEqual(HEALTH);
    expect(target()?.addr).toBe('10.0.0.9');
  });

  it('does not switch to a different server that happens to answer', async () => {
    const other = { ...HEALTH, serverId: 'srv-OTHER' };
    const found: FoundServer = { serverId: 'srv-OTHER', schoolId: null, name: 'Other', addrs: ['10.0.0.9'], port: 7700, certFp: 'BB', from: '10.0.0.9' };
    const { platform } = fakePlatform({ up: { '10.0.0.9': () => ({ status: 200, body: other }) }, found: [found] });
    const { api } = client(platform, saved);
    await expect(api.call('GET /health')).rejects.toMatchObject({ code: 'SERVER_UNREACHABLE' });
  });

  it('never retries elsewhere after a certificate mismatch', async () => {
    const { platform, calls } = fakePlatform({ up: {} });
    platform.request = async () => {
      calls.push('x');
      throw new PlatformError('pin-mismatch', 'mismatch');
    };
    const { api } = client(platform, saved);
    await expect(api.call('GET /health')).rejects.toMatchObject({ kind: 'pin-mismatch' });
    expect(calls).toHaveLength(1);
  });

  it('hands the app a call to repeat by itself, to the server it talks to now, and null to stop', () => {
    const { platform } = fakePlatform({ up: {} });
    const asked: unknown[] = [];
    platform.keepAlive = async (req, everyMs) => { asked.push(req && { ...req, everyMs }); };
    const { api } = client(platform, saved);
    api.keepAlive({ key: 'POST /api/v1/shows/:id/beat', input: { params: { id: 'show 1' } }, token: 'tok' }, 5000);
    api.keepAlive(null);
    expect(asked).toEqual([
      { baseUrl: 'https://192.168.1.20:7700', certFp: 'AA', method: 'POST', path: '/api/v1/shows/show%201/beat', body: undefined, token: 'tok', everyMs: 5000 },
      null,
    ]);
  });

  it('does nothing about repeating where there is no native side', () => {
    const { platform } = fakePlatform({ up: {} });
    const { api } = client(platform, saved);
    expect(() => api.keepAlive({ key: 'POST /api/v1/shows/:id/beat', input: { params: { id: 'x' } } }, 5000)).not.toThrow();
  });

  it('says in plain words what is wrong with something typed, and does not send it', async () => {
    const { platform, calls } = fakePlatform({ up: { '192.168.1.20': () => ({ status: 201, body: {} }) } });
    const { api } = client(platform, saved);
    const tooLong = api.call('POST /api/v1/classes', { body: { name: 'X'.repeat(40) } });
    await expect(tooLong).rejects.toMatchObject({ status: 400, code: 'BAD_REQUEST', message: 'The name is too long. Use at most 32 letters.' });
    expect(calls).toEqual([]);
  });
});
