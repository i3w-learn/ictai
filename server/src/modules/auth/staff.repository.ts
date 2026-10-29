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

  list(): StaffRow[] {
    return this.db
      .prepare(`SELECT ${COLUMNS} FROM users WHERE status != 'deleted' ORDER BY display_name COLLATE NOCASE`)
      .all() as StaffRow[];
  }

  insertTeacher(u: { username: string; displayName: string; passwordHash: string; now: number }): StaffRow {
    const id = randomUUID();
    this.db
      .prepare(
        `INSERT INTO users (id, role, username, display_name, password_hash, created_at, updated_at)
         VALUES (?, 'teacher', ?, ?, ?, ?, ?)`,
      )
      .run(id, u.username, u.displayName, u.passwordHash, u.now, u.now);
    return this.findById(id)!;
  }

  update(
    id: string,
    f: { displayName?: string; canHostLessons?: boolean; canUploadContent?: boolean; status?: StaffRow['status']; passwordHash?: string },
    now: number,
  ) {
    const sets: Record<string, unknown> = {
      display_name: f.displayName,
      can_host_lessons: f.canHostLessons === undefined ? undefined : Number(f.canHostLessons),
      can_upload_content: f.canUploadContent === undefined ? undefined : Number(f.canUploadContent),
      status: f.status,
      password_hash: f.passwordHash,
    };
    const cols = Object.keys(sets).filter((k) => sets[k] !== undefined);
    if (cols.length === 0) return;
    this.db
      .prepare(`UPDATE users SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...cols.map((c) => sets[c]), now, id);
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
