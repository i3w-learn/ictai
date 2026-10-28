import { randomUUID } from 'node:crypto';
import type { StaffRole } from '@ict/contracts';
import type { Db } from '../../infra/db/index.js';

export interface StaffRow {
  id: string;
  role: StaffRole;
  username: string;
  display_name: string;
  password_hash: string;
  can_host_lessons: number;
  can_upload_content: number;
  status: 'active' | 'disabled' | 'deleted';
}

const COLUMNS = 'id, role, username, display_name, password_hash, can_host_lessons, can_upload_content, status';

export class StaffRepository {
  constructor(private readonly db: Db) {}

  findByUsername(username: string): StaffRow | undefined {
    return this.db.prepare(`SELECT ${COLUMNS} FROM users WHERE username = ?`).get(username) as StaffRow | undefined;
  }

  findById(id: string): StaffRow | undefined {
    return this.db.prepare(`SELECT ${COLUMNS} FROM users WHERE id = ?`).get(id) as StaffRow | undefined;
  }

  upsert(u: { username: string; passwordHash: string; role: StaffRole; displayName: string; now: number }) {
    this.db
      .prepare(
        `INSERT INTO users (id, role, username, display_name, password_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(username) DO UPDATE SET role = excluded.role, password_hash = excluded.password_hash,
           display_name = excluded.display_name, status = 'active', updated_at = excluded.updated_at`,
      )
      .run(randomUUID(), u.role, u.username, u.displayName, u.passwordHash, u.now, u.now);
  }
}
