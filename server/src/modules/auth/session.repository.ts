import { randomUUID } from 'node:crypto';
import type { Db } from '../../infra/db/index.js';

export type SessionKind = 'staff' | 'student' | 'guardian';

export interface SessionRow {
  id: string;
  kind: SessionKind;
  user_id: string;
  device_id: string | null;
  last_used_at: number;
  idle_ms: number;
  expires_at: number;
}

export class SessionRepository {
  constructor(private readonly db: Db) {}

  insert(s: { tokenHash: string; kind: SessionKind; userId: string; deviceId: string | null; now: number; idleMs: number; expiresAt: number }) {
    this.db
      .prepare(
        `INSERT INTO sessions (id, token_hash, kind, user_id, device_id, created_at, last_used_at, idle_ms, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(randomUUID(), s.tokenHash, s.kind, s.userId, s.deviceId, s.now, s.now, s.idleMs, s.expiresAt);
  }

  findByTokenHash(hash: string): SessionRow | undefined {
    return this.db
      .prepare('SELECT id, kind, user_id, device_id, last_used_at, idle_ms, expires_at FROM sessions WHERE token_hash = ?')
      .get(hash) as SessionRow | undefined;
  }

  touch(id: string, now: number) {
    this.db.prepare('UPDATE sessions SET last_used_at = ? WHERE id = ?').run(now, id);
  }

  delete(id: string) {
    this.db.prepare('DELETE FROM sessions WHERE id = ?').run(id);
  }

  deleteByTokenHash(hash: string) {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash);
  }
}
