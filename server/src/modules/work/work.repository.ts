import type { Assignment, AssignmentInput, MyWork, StudentAnswer } from '@ict/contracts';
import type { Db } from '../../infra/db/index.js';

// The students a piece of work is for: the class, or one section of it.
const FOR_WORK = `st.class_id = a.class_id AND st.status = 'active' AND (a.section_id IS NULL OR st.section_id = a.section_id)`;

const SELECT = `
  SELECT a.id, a.title, a.instructions, a.class_id AS classId, c.name AS className, a.section_id AS sectionId, s.name AS sectionName,
         a.subject, a.due_at AS dueAt, a.max_marks AS maxMarks, u.display_name AS byName, a.created_at AS createdAt,
         (SELECT COUNT(*) FROM students st WHERE ${FOR_WORK}) AS students,
         (SELECT COUNT(DISTINCT sub.student_id) FROM submissions sub JOIN students st ON st.id = sub.student_id WHERE sub.assignment_id = a.id AND ${FOR_WORK}) AS handedIn,
         (SELECT COUNT(*) FROM work_marks m JOIN students st ON st.id = m.student_id WHERE m.assignment_id = a.id AND ${FOR_WORK}) AS marked
  FROM assignments a
  JOIN classes c ON c.id = a.class_id
  LEFT JOIN sections s ON s.id = a.section_id
  JOIN users u ON u.id = a.created_by`;

interface AnswerRow { studentId: string; name: string; rollNo: string | null; body: string | null; submittedAt: number | null; late: number | null; tries: number; marks: number | null; comment: string | null; markedAt: number | null }
interface MyRow { id: string; title: string; instructions: string; subject: string | null; dueAt: number | null; maxMarks: number; byName: string; body: string | null; submittedAt: number | null; late: number | null; marks: number | null; comment: string | null; markedAt: number | null }

const answerOf = (r: { body: string | null; submittedAt: number | null; late: number | null }) =>
  r.body === null ? null : { body: r.body, submittedAt: r.submittedAt!, late: !!r.late };
const markOf = (r: { marks: number | null; comment: string | null; markedAt: number | null }) =>
  r.marks === null ? null : { marks: r.marks, comment: r.comment ?? '', markedAt: r.markedAt! };

export class WorkRepository {
  constructor(private readonly db: Db) {}

  insert(id: string, a: AssignmentInput, by: string, now: number) {
    this.db
      .prepare('INSERT INTO assignments (id, title, instructions, class_id, section_id, subject, due_at, max_marks, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, a.title, a.instructions, a.classId, a.sectionId, a.subject, a.dueAt, a.maxMarks, by, now);
  }

  get(id: string): Assignment | undefined {
    return this.db.prepare(`${SELECT} WHERE a.id = ? AND a.deleted_at IS NULL`).get(id) as Assignment | undefined;
  }

  all(): Assignment[] {
    return this.db.prepare(`${SELECT} WHERE a.deleted_at IS NULL ORDER BY a.created_at DESC`).all() as Assignment[];
  }

  remove(id: string, now: number) {
    this.db.prepare('UPDATE assignments SET deleted_at = ? WHERE id = ?').run(now, id);
  }

  // Every student the work is for, with their newest answer and their mark, in roll-number order.
  answers(id: string): StudentAnswer[] {
    const rows = this.db
      .prepare(
        `SELECT st.id AS studentId, st.name, st.roll_no AS rollNo, sub.body, sub.submitted_at AS submittedAt, sub.late,
                (SELECT COUNT(*) FROM submissions x WHERE x.assignment_id = a.id AND x.student_id = st.id) AS tries,
                m.marks, m.comment, m.marked_at AS markedAt
         FROM assignments a
         JOIN students st ON ${FOR_WORK}
         LEFT JOIN submissions sub ON sub.id = (SELECT MAX(x.id) FROM submissions x WHERE x.assignment_id = a.id AND x.student_id = st.id)
         LEFT JOIN work_marks m ON m.assignment_id = a.id AND m.student_id = st.id
         WHERE a.id = ?
         ORDER BY CAST(st.roll_no AS INTEGER), st.roll_no, st.name`,
      )
      .all(id) as AnswerRow[];
    return rows.map((r) => ({ studentId: r.studentId, name: r.name, rollNo: r.rollNo, answer: answerOf(r), tries: r.tries, mark: markOf(r) }));
  }

  isFor(id: string, studentId: string): boolean {
    return !!this.db.prepare(`SELECT 1 FROM assignments a JOIN students st ON ${FOR_WORK} WHERE a.id = ? AND a.deleted_at IS NULL AND st.id = ?`).get(id, studentId);
  }

  addAnswer(id: string, studentId: string, body: string, now: number, late: boolean) {
    this.db.prepare('INSERT INTO submissions (assignment_id, student_id, body, submitted_at, late) VALUES (?, ?, ?, ?, ?)').run(id, studentId, body, now, late ? 1 : 0);
  }

  tries(id: string, studentId: string): number {
    return this.db.prepare('SELECT COUNT(*) FROM submissions WHERE assignment_id = ? AND student_id = ?').pluck().get(id, studentId) as number;
  }

  latestAnswer(id: string, studentId: string): string | undefined {
    return this.db.prepare('SELECT body FROM submissions WHERE assignment_id = ? AND student_id = ? ORDER BY id DESC LIMIT 1').pluck().get(id, studentId) as string | undefined;
  }

  hasAnswer(id: string, studentId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM submissions WHERE assignment_id = ? AND student_id = ?').get(id, studentId);
  }

  isMarked(id: string, studentId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM work_marks WHERE assignment_id = ? AND student_id = ?').get(id, studentId);
  }

  setMark(id: string, studentId: string, marks: number, comment: string, by: string, now: number) {
    this.db
      .prepare(
        `INSERT INTO work_marks (assignment_id, student_id, marks, comment, marked_by, marked_at) VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(assignment_id, student_id) DO UPDATE SET marks = excluded.marks, comment = excluded.comment, marked_by = excluded.marked_by, marked_at = excluded.marked_at`,
      )
      .run(id, studentId, marks, comment, by, now);
  }

  // One student's own work. `only` narrows it to a single piece.
  forStudent(studentId: string, now: number, only?: string): MyWork[] {
    const rows = this.db
      .prepare(
        `SELECT a.id, a.title, a.instructions, a.subject, a.due_at AS dueAt, a.max_marks AS maxMarks, u.display_name AS byName,
                sub.body, sub.submitted_at AS submittedAt, sub.late, m.marks, m.comment, m.marked_at AS markedAt
         FROM students st
         JOIN assignments a ON ${FOR_WORK} AND a.deleted_at IS NULL
         JOIN users u ON u.id = a.created_by
         LEFT JOIN submissions sub ON sub.id = (SELECT MAX(x.id) FROM submissions x WHERE x.assignment_id = a.id AND x.student_id = st.id)
         LEFT JOIN work_marks m ON m.assignment_id = a.id AND m.student_id = st.id
         WHERE st.id = ? ${only ? 'AND a.id = ?' : ''}
         ORDER BY a.created_at DESC`,
      )
      .all(...(only ? [studentId, only] : [studentId])) as MyRow[];
    return rows.map((r) => {
      const answer = answerOf(r);
      const mark = markOf(r);
      return {
        id: r.id, title: r.title, instructions: r.instructions, subject: r.subject, dueAt: r.dueAt, maxMarks: r.maxMarks, byName: r.byName,
        status: mark ? 'marked' : answer ? 'submitted' : 'todo',
        overdue: !answer && !mark && r.dueAt !== null && r.dueAt <= now,
        answer, mark,
      };
    });
  }
}
