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

  deleteForUser(kind: SessionKind, userId: string) {
    this.db.prepare('DELETE FROM sessions WHERE kind = ? AND user_id = ?').run(kind, userId);
  }

  // The lab PC a student is using right now, if it is not `exceptDeviceId`. Dead sessions do not count.
  liveStudentDevice(studentId: string, exceptDeviceId: string, now: number): string | undefined {
    return this.db
      .prepare(
        `SELECT device_id FROM sessions
         WHERE kind = 'student' AND user_id = ? AND device_id IS NOT ? AND expires_at >= ? AND ? - last_used_at <= idle_ms
         LIMIT 1`,
      )
      .pluck()
      .get(studentId, exceptDeviceId, now, now) as string | undefined;
  }

  // Every student signed in right now, oldest sign-in first, with the lab PC they are on.
  liveStudents(now: number): { deviceId: string; name: string; classId: string; className: string }[] {
    return this.db
      .prepare(
        `SELECT s.device_id AS deviceId, st.name, st.class_id AS classId, c.name AS className
         FROM sessions s
         JOIN students st ON st.id = s.user_id AND st.status = 'active'
         JOIN classes c ON c.id = st.class_id
         WHERE s.kind = 'student' AND s.device_id IS NOT NULL AND s.expires_at >= ? AND ? - s.last_used_at <= s.idle_ms
         ORDER BY s.created_at`,
      )
      .all(now, now) as { deviceId: string; name: string; classId: string; className: string }[];
  }

  deleteByTokenHash(hash: string) {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hash);
  }
}
