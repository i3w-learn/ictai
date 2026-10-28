import type { RosterEntry, Student } from '@ict/contracts';
import type { Db } from '../../infra/db/index.js';

export interface StudentAuthRow {
  id: string;
  name: string;
  class_id: string;
  section_id: string | null;
  pin_hash: string | null;
}

interface StudentRow extends StudentAuthRow {
  roll_no: string | null;
}

const toStudent = (r: StudentRow): Student => ({
  id: r.id, name: r.name, classId: r.class_id, sectionId: r.section_id, rollNo: r.roll_no, hasPin: !!r.pin_hash,
});

const AUTH_COLUMNS = 'id, name, class_id, section_id, pin_hash';

export class StudentRepository {
  constructor(private readonly db: Db) {}

  insert(s: {
    id: string; name: string; classId: string; sectionId: string | null; rollNo: string | null;
    pinHash: string | null; qrTokenHash: string; now: number;
  }): Student {
    this.db
      .prepare(
        `INSERT INTO students (id, name, class_id, section_id, roll_no, pin_hash, qr_token_hash, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(s.id, s.name, s.classId, s.sectionId, s.rollNo, s.pinHash, s.qrTokenHash, s.now, s.now);
    return { id: s.id, name: s.name, classId: s.classId, sectionId: s.sectionId, rollNo: s.rollNo, hasPin: !!s.pinHash };
  }

  listByClass(classId: string): Student[] {
    const rows = this.db
      .prepare(`SELECT ${AUTH_COLUMNS}, roll_no FROM students WHERE class_id = ? AND status = 'active' ORDER BY roll_no, name`)
      .all(classId) as StudentRow[];
    return rows.map(toStudent);
  }

  roster(classId: string): RosterEntry[] {
    return this.db
      .prepare(`SELECT id, name, roll_no AS rollNo FROM students WHERE class_id = ? AND status = 'active' ORDER BY roll_no, name`)
      .all(classId) as RosterEntry[];
  }

  findActive(id: string): StudentAuthRow | undefined {
    return this.db
      .prepare(`SELECT ${AUTH_COLUMNS} FROM students WHERE id = ? AND status = 'active'`)
      .get(id) as StudentAuthRow | undefined;
  }

  findByQrHash(hash: string): StudentAuthRow | undefined {
    return this.db
      .prepare(`SELECT ${AUTH_COLUMNS} FROM students WHERE qr_token_hash = ? AND status = 'active'`)
      .get(hash) as StudentAuthRow | undefined;
  }

  findByEnrolCodeHash(hash: string, now: number): StudentAuthRow | undefined {
    return this.db
      .prepare(`SELECT ${AUTH_COLUMNS} FROM students WHERE enrol_code_hash = ? AND enrol_code_expires_at > ? AND status = 'active'`)
      .get(hash, now) as StudentAuthRow | undefined;
  }

  setPin(id: string, pinHash: string, now: number) {
    this.db.prepare('UPDATE students SET pin_hash = ?, updated_at = ? WHERE id = ?').run(pinHash, now, id);
  }

  setEnrolCode(id: string, codeHash: string | null, expiresAt: number | null, now: number) {
    this.db
      .prepare('UPDATE students SET enrol_code_hash = ?, enrol_code_expires_at = ?, updated_at = ? WHERE id = ?')
      .run(codeHash, expiresAt, now, id);
  }

  enrolCodeInUse(hash: string, now: number): boolean {
    return !!this.db.prepare('SELECT 1 FROM students WHERE enrol_code_hash = ? AND enrol_code_expires_at > ?').get(hash, now);
  }
}
