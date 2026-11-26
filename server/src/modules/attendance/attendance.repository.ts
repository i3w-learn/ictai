import type { AttendanceRow } from '@ict/contracts';
import type { Db } from '../../infra/db/index.js';

type Row = Omit<AttendanceRow, 'present'> & { present: number | null };

export class AttendanceRepository {
  constructor(private readonly db: Db) {}

  // The student signed in. Only the first mark of the day is kept: a later sign-in does not move the
  // time, and it never undoes what a teacher has set.
  signedIn(studentId: string, day: string, now: number) {
    this.db
      .prepare(`INSERT OR IGNORE INTO attendance (student_id, day, present, source, at) VALUES (?, ?, 1, 'signin', ?)`)
      .run(studentId, day, now);
  }

  // A teacher's mark replaces whatever was there.
  mark(studentId: string, day: string, present: boolean, by: string, now: number) {
    this.db
      .prepare(
        `INSERT INTO attendance (student_id, day, present, source, marked_by, at) VALUES (?, ?, ?, 'teacher', ?, ?)
         ON CONFLICT (student_id, day) DO UPDATE SET present = excluded.present, source = 'teacher', marked_by = excluded.marked_by, at = excluded.at`,
      )
      .run(studentId, day, present ? 1 : 0, by, now);
  }

  // Every student of the class in roll order, with their mark for the day if they have one.
  forClass(classId: string, day: string): AttendanceRow[] {
    const rows = this.db
      .prepare(
        `SELECT st.id AS studentId, st.name, st.roll_no AS rollNo, s.name AS sectionName, a.present, a.source AS by, a.at
         FROM students st
         LEFT JOIN sections s ON s.id = st.section_id
         LEFT JOIN attendance a ON a.student_id = st.id AND a.day = ?
         WHERE st.class_id = ? AND st.status = 'active'
         ORDER BY CAST(st.roll_no AS INTEGER), st.roll_no, st.name`,
      )
      .all(day, classId) as Row[];
    return rows.map((r) => ({ ...r, present: r.present === 1 }));
  }
}
