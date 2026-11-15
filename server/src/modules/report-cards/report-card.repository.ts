import type { CardMarks, CardStatus, ReportCard } from '@ict/contracts';
import type { Db } from '../../infra/db/index.js';

interface Row { id: string; term: string; status: CardStatus; remarks: string; marks_json: string; studentId: string; name: string; rollNo: string | null; className: string; sectionName: string | null; classId: string }

const SELECT = `
  SELECT r.id, r.term, r.status, r.remarks, r.marks_json, st.id AS studentId, st.name, st.roll_no AS rollNo,
         c.name AS className, s.name AS sectionName, r.class_id AS classId
  FROM report_cards r
  JOIN students st ON st.id = r.student_id
  JOIN classes c ON c.id = r.class_id
  LEFT JOIN sections s ON s.id = st.section_id`;

const toCard = (r: Row): ReportCard & { classId: string } => ({
  id: r.id, term: r.term, status: r.status, remarks: r.remarks, classId: r.classId,
  student: { id: r.studentId, name: r.name, rollNo: r.rollNo, className: r.className, sectionName: r.sectionName },
  marks: JSON.parse(r.marks_json) as CardMarks,
});

export class ReportCardRepository {
  constructor(private readonly db: Db) {}

  forClass(classId: string, term: string): (ReportCard & { classId: string })[] {
    const rows = this.db.prepare(`${SELECT} WHERE r.class_id = ? AND r.term = ? ORDER BY CAST(st.roll_no AS INTEGER), st.roll_no, st.name`).all(classId, term) as Row[];
    return rows.map(toCard);
  }

  get(id: string): (ReportCard & { classId: string }) | undefined {
    const r = this.db.prepare(`${SELECT} WHERE r.id = ?`).get(id) as Row | undefined;
    return r && toCard(r);
  }

  find(studentId: string, term: string): { id: string; status: CardStatus } | undefined {
    return this.db.prepare('SELECT id, status FROM report_cards WHERE student_id = ? AND term = ?').get(studentId, term) as { id: string; status: CardStatus } | undefined;
  }

  insert(c: { id: string; studentId: string; classId: string; term: string; marks: CardMarks; by: string; now: number }) {
    this.db
      .prepare(`INSERT INTO report_cards (id, student_id, class_id, term, status, remarks, marks_json, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, 'draft', '', ?, ?, ?, ?)`)
      .run(c.id, c.studentId, c.classId, c.term, JSON.stringify(c.marks), c.by, c.now, c.now);
  }

  // Every change names the status it expects, so a card frozen a moment ago is never touched.
  // A draft also follows the student to the class they are in now: a student who changed class after
  // the draft was made shows up in the new class's cards, not the old one's.
  setMarks(id: string, classId: string, marks: CardMarks, now: number): boolean {
    return this.db.prepare(`UPDATE report_cards SET marks_json = ?, class_id = ?, updated_at = ? WHERE id = ? AND status = 'draft'`).run(JSON.stringify(marks), classId, now, id).changes > 0;
  }

  setRemarks(id: string, remarks: string, now: number): boolean {
    return this.db.prepare(`UPDATE report_cards SET remarks = ?, updated_at = ? WHERE id = ? AND status != 'frozen'`).run(remarks, now, id).changes > 0;
  }

  setStatus(id: string, from: CardStatus, to: CardStatus, now: number): boolean {
    return this.db.prepare('UPDATE report_cards SET status = ?, updated_at = ? WHERE id = ? AND status = ?').run(to, now, id, from).changes > 0;
  }

  terms(classId: string): string[] {
    return this.db.prepare('SELECT term FROM report_cards WHERE class_id = ? GROUP BY term ORDER BY MAX(created_at) DESC').pluck().all(classId) as string[];
  }
}
