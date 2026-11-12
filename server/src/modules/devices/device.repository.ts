import type { Device, DeviceKind } from '@ict/contracts';
import type { Db } from '../../infra/db/index.js';

export interface DeviceAuthRow {
  id: string;
  kind: DeviceKind;
  name: string;
  token_expires_at: number;
}

export class DeviceRepository {
  constructor(private readonly db: Db) {}

  // Kept in the small key-value table. No row means open: a new lab works with nothing to set up.
  joiningOpen(): boolean {
    return this.db.prepare(`SELECT value FROM meta WHERE key = 'joining'`).pluck().get() !== 'locked';
  }

  setJoining(open: boolean) {
    this.db.prepare(`INSERT INTO meta (key, value) VALUES ('joining', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`).run(open ? 'open' : 'locked');
  }

  countOf(kind: DeviceKind): number {
    return this.db.prepare('SELECT COUNT(*) FROM devices WHERE kind = ?').pluck().get(kind) as number;
  }

  insert(d: { id: string; kind: DeviceKind; name: string; tokenHash: string; expiresAt: number; appVersion: string; now: number }) {
    this.db
      .prepare(
        `INSERT INTO devices (id, kind, name, token_hash, token_expires_at, app_version, last_seen, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(d.id, d.kind, d.name, d.tokenHash, d.expiresAt, d.appVersion, d.now, d.now);
  }

  findActiveByTokenHash(hash: string): DeviceAuthRow | undefined {
    return this.db
      .prepare(`SELECT id, kind, name, token_expires_at FROM devices WHERE token_hash = ? AND status = 'active'`)
      .get(hash) as DeviceAuthRow | undefined;
  }

  name(id: string): string | undefined {
    return this.db.prepare('SELECT name FROM devices WHERE id = ?').pluck().get(id) as string | undefined;
  }

  isActive(id: string): boolean {
    return !!this.db.prepare(`SELECT 1 FROM devices WHERE id = ? AND status = 'active'`).get(id);
  }

  // Returns false when there is no such device in the lab.
  retire(id: string): boolean {
    return this.db.prepare(`UPDATE devices SET status = 'retired' WHERE id = ? AND status = 'active'`).run(id).changes > 0;
  }

  markSeen(id: string, now: number, tokenExpiresAt: number) {
    this.db.prepare('UPDATE devices SET last_seen = ?, token_expires_at = ? WHERE id = ?').run(now, tokenExpiresAt, id);
  }

  list(): Omit<Device, 'connected' | 'student'>[] {
    const rows = this.db
      .prepare(`SELECT id, kind, name, status, app_version, last_seen FROM devices WHERE status = 'active' ORDER BY created_at`)
      .all() as { id: string; kind: DeviceKind; name: string; status: Device['status']; app_version: string | null; last_seen: number | null }[];
    return rows.map((r) => ({ id: r.id, kind: r.kind, name: r.name, status: r.status, appVersion: r.app_version, lastSeen: r.last_seen }));
  }
}
