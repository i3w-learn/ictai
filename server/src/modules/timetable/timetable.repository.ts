import type { Slot, SlotInput } from '@ict/contracts';
import type { Db } from '../../infra/db/index.js';

const SELECT = `
  SELECT t.day, t.period_id AS periodId, t.class_id AS classId, c.name AS className,
         t.section_id AS sectionId, s.name AS sectionName, t.subject
  FROM timetable_slots t
  JOIN classes c ON c.id = t.class_id
  LEFT JOIN sections s ON s.id = t.section_id`;

export class TimetableRepository {
  constructor(private readonly db: Db) {}

  all(): Slot[] {
    return this.db.prepare(`${SELECT} ORDER BY t.day`).all() as Slot[];
  }

  at(day: number, periodId: string): Slot | undefined {
    return this.db.prepare(`${SELECT} WHERE t.day = ? AND t.period_id = ?`).get(day, periodId) as Slot | undefined;
  }

  // One class per period per day: writing a slot replaces whatever was there.
  put(s: SlotInput, now: number) {
    this.db
      .prepare(
        `INSERT INTO timetable_slots (day, period_id, class_id, section_id, subject, updated_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(day, period_id) DO UPDATE SET class_id = excluded.class_id, section_id = excluded.section_id, subject = excluded.subject, updated_at = excluded.updated_at`,
      )
      .run(s.day, s.periodId, s.classId, s.sectionId, s.subject, now);
  }

  clear(day: number, periodId: string) {
    this.db.prepare('DELETE FROM timetable_slots WHERE day = ? AND period_id = ?').run(day, periodId);
  }

  clearPeriod(periodId: string) {
    this.db.prepare('DELETE FROM timetable_slots WHERE period_id = ?').run(periodId);
  }

  // A student's own lab periods on one day: their class's slots that are for every section or for theirs.
  forStudent(day: number, classId: string, sectionId: string | null): { periodName: string; start: string; end: string; subject: string | null }[] {
    return this.db
      .prepare(
        `SELECT p.name AS periodName, p.starts_at AS start, p.ends_at AS "end", t.subject
         FROM timetable_slots t JOIN periods p ON p.id = t.period_id
         WHERE t.day = ? AND t.class_id = ? AND (t.section_id IS NULL OR t.section_id = ?)
         ORDER BY p.starts_at`,
      )
      .all(day, classId, sectionId) as { periodName: string; start: string; end: string; subject: string | null }[];
  }
}
