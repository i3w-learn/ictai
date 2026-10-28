import { createSocket } from 'node:dgram';
import { existsSync, mkdtempSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { migrate, openDb } from '../src/infra/db/index.js';
import { migrations } from '../src/infra/db/migrations.js';
import { acquireSingleInstance } from '../src/infra/lock.js';
import { lanAddresses } from '../src/infra/net/addresses.js';
import { startBeacon } from '../src/infra/net/beacon.js';
import { loadOrCreateTls } from '../src/infra/net/tls.js';

const tmp = () => mkdtempSync(join(tmpdir(), 'ict-test-'));

describe('migrations', () => {
  it('run once and are skipped on the next start', () => {
    const db = openDb(':memory:');
    expect(migrate(db, migrations, null)).toEqual([]);
  });

  it('back up the database before a new migration', () => {
    const dir = tmp();
    const file = join(dir, 'ict.db');
    openDb(file).close();
    const next = [...migrations, { version: 999, name: 'extra', sql: 'CREATE TABLE extra (id INTEGER)' }];
    const db = openDb(file, next);
    expect(db.prepare('SELECT COUNT(*) FROM schema_migrations').pluck().get()).toBe(migrations.length + 1);
    expect(readdirSync(join(dir, 'backups')).some((f) => f.startsWith('pre-migration-999-'))).toBe(true);
  });
});

describe('single-instance lock', () => {
  it('refuses a second copy and allows one after release', () => {
    const file = join(tmp(), 'server.lock');
    const release = acquireSingleInstance(file);
    expect(() => acquireSingleInstance(file)).toThrow(/already running/);
    release();
    expect(existsSync(file)).toBe(false);
    acquireSingleInstance(file)();
  });
});

describe('lanAddresses', () => {
  it('keeps private IPv4 on real adapters and drops virtual ones', () => {
    const v4 = (address: string, internal = false) =>
      ({ address, family: 'IPv4', internal, netmask: '', mac: '', cidr: null }) as const;
    const out = lanAddresses({
      Ethernet: [v4('192.168.1.20')],
      'vEthernet (WSL)': [v4('172.20.0.1')],
      'Wi-Fi': [v4('10.0.0.5'), v4('8.8.8.8')],
      lo0: [v4('127.0.0.1', true)],
    });
    expect(out).toEqual(['192.168.1.20', '10.0.0.5']);
  });
});

describe('discovery beacon', () => {
  it('answers a discover message and ignores junk', async () => {
    const beacon = await startBeacon({
      port: 0,
      host: '127.0.0.1',
      here: () => ({ serverId: 'srv-1', schoolId: null, name: 'Lab', addrs: ['192.168.1.20'], port: 7700, certFp: 'AA' }),
    });
    const client = createSocket('udp4');
    const reply = new Promise<string>((resolve) => client.once('message', (m) => resolve(m.toString())));
    client.send('not json', beacon.port, '127.0.0.1');
    client.send(JSON.stringify({ t: 'discover', v: 1, app: 'student', ver: '0.1.0' }), beacon.port, '127.0.0.1');
    expect(JSON.parse(await reply)).toEqual({
      t: 'here', v: 1, serverId: 'srv-1', schoolId: null, name: 'Lab', addrs: ['192.168.1.20'], port: 7700, certFp: 'AA',
    });
    client.close();
    await beacon.close();
  });
});

describe('TLS', () => {
  it('creates a certificate once and keeps the same fingerprint', async () => {
    const dir = tmp();
    const a = await loadOrCreateTls(dir, 'srv-1');
    const b = await loadOrCreateTls(dir, 'srv-1');
    expect(a.fingerprint).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    expect(b.fingerprint).toBe(a.fingerprint);
  }, 30_000);
});

describe('isAllowedLocalAddress', () => {
  it('allows loopback and listed LAN addresses only', async () => {
    const { isAllowedLocalAddress } = await import('../src/infra/net/private-only.js');
    const lan = ['192.168.1.20'];
    expect(isAllowedLocalAddress('127.0.0.1', lan)).toBe(true);
    expect(isAllowedLocalAddress('::ffff:192.168.1.20', lan)).toBe(true);
    expect(isAllowedLocalAddress('172.20.0.1', lan)).toBe(false); // e.g. a WSL adapter
    expect(isAllowedLocalAddress('203.0.113.5', lan)).toBe(false);
  });
});

describe('consumeBootstrapAdmin', () => {
  it('creates the first Super Admin once and deletes the file', async () => {
    const { writeFileSync } = await import('node:fs');
    const { consumeBootstrapAdmin } = await import('../src/modules/auth/bootstrap-admin.js');
    const { testServer } = await import('./helpers.js');
    const t = await testServer();
    const file = join(tmp(), 'bootstrap-admin.json');
    writeFileSync(file, JSON.stringify({ username: 'principal', password: 'long-enough-pass' }));
    expect(await consumeBootstrapAdmin(file, t.c.staffAuth)).toBe(true);
    expect(existsSync(file)).toBe(false);
    const me = await t.app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: t.auth(await t.login('principal', 'long-enough-pass')) });
    expect(me.json().role).toBe('super_admin');
    expect(await consumeBootstrapAdmin(file, t.c.staffAuth)).toBe(false);
  });
});
