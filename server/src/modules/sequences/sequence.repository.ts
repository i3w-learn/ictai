import type { SequenceType, StepKind } from '@ict/contracts';
import type { Db } from '../../infra/db/index.js';

export interface SequenceRow { id: string; type: SequenceType; title: string; classId: string; className: string; subject: string | null; byName: string; createdAt: number }
export interface StepRow { id: string; sequenceId: string; kind: StepKind; contentId: string | null; assignmentId: string | null; workTitle: string | null; workGone: number | null }

const SELECT = `
  SELECT q.id, q.type, q.title, q.class_id AS classId, c.name AS className, q.subject, u.display_name AS byName, q.created_at AS createdAt
  FROM sequences q JOIN classes c ON c.id = q.class_id JOIN users u ON u.id = q.created_by`;

export class SequenceRepository {
  constructor(private readonly db: Db) {}

  insert(s: { id: string; type: SequenceType; title: string; classId: string; subject: string | null; by: string; now: number }, steps: { id: string; kind: StepKind; refId: string }[]) {
    this.db.transaction(() => {
      this.db.prepare('INSERT INTO sequences (id, type, title, class_id, subject, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(s.id, s.type, s.title, s.classId, s.subject, s.by, s.now);
      const add = this.db.prepare('INSERT INTO sequence_steps (id, sequence_id, position, kind, content_id, assignment_id) VALUES (?, ?, ?, ?, ?, ?)');
      steps.forEach((st, i) => add.run(st.id, s.id, i, st.kind, st.kind === 'content' ? st.refId : null, st.kind === 'work' ? st.refId : null));
    })();
  }

  get(id: string): SequenceRow | undefined {
    return this.db.prepare(`${SELECT} WHERE q.id = ? AND q.deleted_at IS NULL`).get(id) as SequenceRow | undefined;
  }

  all(classId?: string): SequenceRow[] {
    return (classId
      ? this.db.prepare(`${SELECT} WHERE q.deleted_at IS NULL AND q.class_id = ? ORDER BY q.created_at DESC`).all(classId)
      : this.db.prepare(`${SELECT} WHERE q.deleted_at IS NULL ORDER BY q.created_at DESC`).all()) as SequenceRow[];
  }

  remove(id: string, now: number) {
    this.db.prepare('UPDATE sequences SET deleted_at = ? WHERE id = ?').run(now, id);
  }

  steps(sequenceIds: string[]): StepRow[] {
    if (sequenceIds.length === 0) return [];
    return this.db
      .prepare(
        `SELECT s.id, s.sequence_id AS sequenceId, s.kind, s.content_id AS contentId, s.assignment_id AS assignmentId,
                a.title AS workTitle, a.deleted_at AS workGone
         FROM sequence_steps s LEFT JOIN assignments a ON a.id = s.assignment_id
         WHERE s.sequence_id IN (${sequenceIds.map(() => '?').join(',')}) ORDER BY s.sequence_id, s.position`,
      )
      .all(...sequenceIds) as StepRow[];
  }

  step(id: string): { id: string; sequenceId: string; kind: StepKind; classId: string } | undefined {
    return this.db
      .prepare(`SELECT s.id, s.sequence_id AS sequenceId, s.kind, q.class_id AS classId FROM sequence_steps s JOIN sequences q ON q.id = s.sequence_id WHERE s.id = ? AND q.deleted_at IS NULL`)
      .get(id) as { id: string; sequenceId: string; kind: StepKind; classId: string } | undefined;
  }

  markDone(stepId: string, studentId: string, now: number) {
    this.db.prepare('INSERT OR IGNORE INTO step_done (step_id, student_id, done_at) VALUES (?, ?, ?)').run(stepId, studentId, now);
  }

  // The content steps this student has opened.
  doneSteps(studentId: string): Set<string> {
    return new Set(this.db.prepare('SELECT step_id FROM step_done WHERE student_id = ?').pluck().all(studentId) as string[]);
  }

  // The pieces of work this student has handed in: a work step is done when its work is handed in.
  handedIn(studentId: string): Set<string> {
    return new Set(this.db.prepare('SELECT DISTINCT assignment_id FROM submissions WHERE student_id = ?').pluck().all(studentId) as string[]);
  }

  classStudents(classId: string): string[] {
    return this.db.prepare(`SELECT id FROM students WHERE class_id = ? AND status = 'active'`).pluck().all(classId) as string[];
  }
}
