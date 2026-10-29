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

  get(id: string): Student | undefined {
    const row = this.db
      .prepare(`SELECT ${AUTH_COLUMNS}, roll_no FROM students WHERE id = ? AND status = 'active'`)
      .get(id) as StudentRow | undefined;
    return row && toStudent(row);
  }

  update(id: string, f: { name?: string; sectionId?: string | null; rollNo?: string | null }, now: number) {
    const sets: Record<string, unknown> = { name: f.name, section_id: f.sectionId, roll_no: f.rollNo };
    const cols = Object.keys(sets).filter((k) => sets[k] !== undefined);
    if (cols.length === 0) return;
    this.db
      .prepare(`UPDATE students SET ${cols.map((c) => `${c} = ?`).join(', ')}, updated_at = ? WHERE id = ?`)
      .run(...cols.map((c) => sets[c]), now, id);
  }

  // Spec 4.1: the same name + class + roll number counts as a duplicate. A missing roll number matches a missing one.
  findDuplicate(name: string, classId: string, rollNo: string | null, exceptId?: string): boolean {
    return !!this.db
      .prepare(
        `SELECT 1 FROM students WHERE name = ? COLLATE NOCASE AND class_id = ? AND roll_no IS ? AND status = 'active' AND id IS NOT ?`,
      )
      .get(name, classId, rollNo, exceptId ?? null);
  }

  setQrHash(id: string, hash: string, now: number) {
    this.db.prepare('UPDATE students SET qr_token_hash = ?, updated_at = ? WHERE id = ?').run(hash, now, id);
  }

  // Moves every active student; each section is swapped for the new class's section of the same name, or cleared.
  moveClass(fromClassId: string, toClassId: string, sectionMap: Map<string, string | null>, now: number): number {
    const rows = this.db
      .prepare(`SELECT id, section_id FROM students WHERE class_id = ? AND status = 'active'`)
      .all(fromClassId) as { id: string; section_id: string | null }[];
    const move = this.db.prepare('UPDATE students SET class_id = ?, section_id = ?, updated_at = ? WHERE id = ?');
    this.db.transaction(() => {
      for (const r of rows) move.run(toClassId, r.section_id ? (sectionMap.get(r.section_id) ?? null) : null, now, r.id);
    })();
    return rows.length;
  }

  // A pending first sign-in code dies with the student.
  markDeleted(id: string, now: number) {
    this.db
      .prepare(`UPDATE students SET status = 'deleted', enrol_code_hash = NULL, enrol_code_expires_at = NULL, updated_at = ? WHERE id = ?`)
      .run(now, id);
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
