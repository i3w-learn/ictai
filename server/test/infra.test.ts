import { createSocket } from 'node:dgram';
import { existsSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
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

  it('let the library hold activities, and keep every library item and what points at it', () => {
    const db = openDb(':memory:', migrations.filter((m) => m.version < 20));
    db.exec(`
      INSERT INTO users (id, role, username, display_name, password_hash, created_at, updated_at) VALUES ('u1', 'super_admin', 'admin', 'Admin', 'x', 1, 1);
      INSERT INTO classes (id, name, created_at) VALUES ('c7', '7', 1);
      INSERT INTO files (sha256, size, mime, created_at) VALUES ('h1', 10, 'application/pdf', 1);
      INSERT INTO content_items (id, title, kind, class_id, subject, chapter, file_hash, file_name, created_by, created_at) VALUES ('book', 'Water', 'pdf', 'c7', 'Science', 'Ch 1', 'h1', 'water.pdf', 'u1', 5);
      INSERT INTO content_items (id, title, kind, class_id, url, needs_internet, created_by, created_at, deleted_at) VALUES ('link', 'A page', 'link', 'c7', 'https://example.org', 1, 'u1', 6, 9);
      INSERT INTO sequences (id, type, title, class_id, created_by, created_at) VALUES ('s1', 'playlist', 'List', 'c7', 'u1', 7);
      INSERT INTO sequence_steps (id, sequence_id, position, kind, content_id) VALUES ('st1', 's1', 0, 'content', 'book');
    `);
    expect(() => db.prepare("INSERT INTO content_items (id, title, kind, class_id, created_by, created_at) VALUES ('a', 'Game', 'activity', 'c7', 'u1', 8)").run()).toThrow(/CHECK/);

    expect(migrate(db, migrations.filter((m) => m.version <= 20), null)).toEqual([20]);
    expect(db.prepare('SELECT id, title, kind, subject, chapter, file_hash, file_name, url, needs_internet, created_at, deleted_at FROM content_items ORDER BY created_at').all()).toEqual([
      { id: 'book', title: 'Water', kind: 'pdf', subject: 'Science', chapter: 'Ch 1', file_hash: 'h1', file_name: 'water.pdf', url: null, needs_internet: 0, created_at: 5, deleted_at: null },
      { id: 'link', title: 'A page', kind: 'link', subject: null, chapter: null, file_hash: null, file_name: null, url: 'https://example.org', needs_internet: 1, created_at: 6, deleted_at: 9 },
    ]);
    // An activity goes in now; a made-up kind still does not.
    db.prepare("INSERT INTO content_items (id, title, kind, class_id, created_by, created_at) VALUES ('a', 'Game', 'activity', 'c7', 'u1', 8)").run();
    expect(() => db.prepare("INSERT INTO content_items (id, title, kind, class_id, created_by, created_at) VALUES ('b', 'x', 'program', 'c7', 'u1', 8)").run()).toThrow(/CHECK/);
    // The links between tables are being watched again, and the playlist step still points at its book.
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
    expect(db.pragma('foreign_key_check')).toEqual([]);
    expect(() => db.prepare("DELETE FROM content_items WHERE id = 'book'").run()).toThrow(/FOREIGN KEY/);
    expect(() => db.prepare("INSERT INTO sequence_steps (id, sequence_id, position, kind, content_id) VALUES ('st2', 's1', 1, 'content', 'nothing')").run()).toThrow(/FOREIGN KEY/);
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'content_items' AND name LIKE 'content_%' ORDER BY name").pluck().all()).toEqual(['content_class', 'content_file']);
  });

  it('keep nothing of a table rebuild that would leave a broken link', () => {
    const db = openDb(':memory:', migrations.filter((m) => m.version < 20));
    const bad = { version: 20, name: 'bad', rebuildsTables: true, sql: "CREATE TABLE t1 (id TEXT PRIMARY KEY); CREATE TABLE t2 (t1_id TEXT REFERENCES t1(id)); INSERT INTO t2 VALUES ('missing');" };
    expect(() => migrate(db, [...migrations.filter((m) => m.version < 20), bad], null)).toThrow(/broken links/);
    expect(db.prepare("SELECT COUNT(*) FROM sqlite_master WHERE name IN ('t1', 't2')").pluck().get()).toBe(0);
    expect(db.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('wipe the PINs and first sign-in codes a school stored before students stopped using them', () => {
    const db = openDb(':memory:', migrations.filter((m) => m.version < 17));
    db.prepare("INSERT INTO classes (id, name, created_at) VALUES ('c7', '7', 1)").run();
    db.prepare(`INSERT INTO students (id, name, class_id, roll_no, pin_hash, qr_token_hash, enrol_code_hash, enrol_code_expires_at, created_at, updated_at)
      VALUES ('s1', 'Asha', 'c7', '5', 'a-pin-hash', 'a-qr-hash', 'a-code-hash', 99, 1, 1)`).run();
    expect(migrate(db, migrations.filter((m) => m.version <= 17), null)).toEqual([17]);
    expect(db.prepare('SELECT name, roll_no, pin_hash, enrol_code_hash, enrol_code_expires_at, qr_token_hash FROM students').all()).toEqual([
      { name: 'Asha', roll_no: '5', pin_hash: null, enrol_code_hash: null, enrol_code_expires_at: null, qr_token_hash: 'a-qr-hash' },
    ]);
  });
});

describe('single-instance lock', () => {
  it('refuses while another live process holds it and allows one after release', () => {
    const file = join(tmp(), 'server.lock');
    const release = acquireSingleInstance(file);
    release();
    expect(existsSync(file)).toBe(false);
    writeFileSync(file, String(process.ppid)); // the test runner's parent: alive, and not us
    expect(() => acquireSingleInstance(file)).toThrow(/already running/);
  });

  // In a fresh container the server always gets the same pid, so a lock left by a killed
  // container names our own pid. That lock is stale, not a second server.
  it('treats a lock holding our own pid as stale', () => {
    const file = join(tmp(), 'server.lock');
    writeFileSync(file, String(process.pid));
    const release = acquireSingleInstance(file);
    expect(readFileSync(file, 'utf8')).toBe(String(process.pid));
    release();
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
