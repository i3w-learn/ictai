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

  isActive(id: string): boolean {
    return !!this.db.prepare(`SELECT 1 FROM devices WHERE id = ? AND status = 'active'`).get(id);
  }

  markSeen(id: string, now: number, tokenExpiresAt: number) {
    this.db.prepare('UPDATE devices SET last_seen = ?, token_expires_at = ? WHERE id = ?').run(now, tokenExpiresAt, id);
  }

  list(): Device[] {
    const rows = this.db
      .prepare('SELECT id, kind, name, status, app_version, last_seen FROM devices ORDER BY created_at')
      .all() as { id: string; kind: DeviceKind; name: string; status: Device['status']; app_version: string | null; last_seen: number | null }[];
    return rows.map((r) => ({ id: r.id, kind: r.kind, name: r.name, status: r.status, appVersion: r.app_version, lastSeen: r.last_seen }));
  }
}
