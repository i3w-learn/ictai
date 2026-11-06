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

// Which classes and subjects a teacher works with. A field left out is left as it is.
export interface TeacherScope {
  classIds?: string[];
  subjects?: string[];
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

  // One transaction: a teacher never exists without their classes and subjects, because a
  // teacher with no scope rows is read as "sees everything".
  insertTeacher(u: { username: string; displayName: string; passwordHash: string; classIds: string[]; subjects: string[]; now: number }): StaffRow {
    const id = randomUUID();
    this.db.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO users (id, role, username, display_name, password_hash, created_at, updated_at)
           VALUES (?, 'teacher', ?, ?, ?, ?, ?)`,
        )
        .run(id, u.username, u.displayName, u.passwordHash, u.now, u.now);
      this.replaceScope(id, u);
    })();
    return this.findById(id)!;
  }

  update(
    id: string,
    f: { displayName?: string; canHostLessons?: boolean; canUploadContent?: boolean; status?: StaffRow['status']; passwordHash?: string } & TeacherScope,
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
    if (cols.length === 0 && !f.classIds && !f.subjects) return;
    this.db.transaction(() => {
      const assign = [...cols.map((c) => `${c} = ?`), 'updated_at = ?'].join(', ');
      this.db.prepare(`UPDATE users SET ${assign} WHERE id = ?`).run(...cols.map((c) => sets[c]), now, id);
      this.replaceScope(id, f);
    })();
  }

  classIds(userId: string): string[] {
    return (this.db.prepare('SELECT class_id FROM teacher_classes WHERE user_id = ? ORDER BY rowid').all(userId) as { class_id: string }[]).map((r) => r.class_id);
  }

  subjects(userId: string): string[] {
    return (this.db.prepare('SELECT subject FROM teacher_subjects WHERE user_id = ? ORDER BY rowid').all(userId) as { subject: string }[]).map((r) => r.subject);
  }

  // Every teacher's classes and subjects in two queries, for the staff list.
  scopesByUser(): Map<string, { classIds: string[]; subjects: string[] }> {
    const map = new Map<string, { classIds: string[]; subjects: string[] }>();
    const of = (userId: string) => {
      let s = map.get(userId);
      if (!s) map.set(userId, (s = { classIds: [], subjects: [] }));
      return s;
    };
    for (const r of this.db.prepare('SELECT user_id, class_id FROM teacher_classes ORDER BY rowid').all() as { user_id: string; class_id: string }[]) {
      of(r.user_id).classIds.push(r.class_id);
    }
    for (const r of this.db.prepare('SELECT user_id, subject FROM teacher_subjects ORDER BY rowid').all() as { user_id: string; subject: string }[]) {
      of(r.user_id).subjects.push(r.subject);
    }
    return map;
  }

  // Runs inside the caller's transaction.
  private replaceScope(userId: string, scope: TeacherScope) {
    if (scope.classIds) {
      this.db.prepare('DELETE FROM teacher_classes WHERE user_id = ?').run(userId);
      const add = this.db.prepare('INSERT OR IGNORE INTO teacher_classes (user_id, class_id) VALUES (?, ?)');
      for (const id of scope.classIds) add.run(userId, id);
    }
    if (scope.subjects) {
      this.db.prepare('DELETE FROM teacher_subjects WHERE user_id = ?').run(userId);
      const add = this.db.prepare('INSERT OR IGNORE INTO teacher_subjects (user_id, subject) VALUES (?, ?)');
      for (const s of scope.subjects) add.run(userId, s);
    }
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
