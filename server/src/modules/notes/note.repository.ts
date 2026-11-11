import type { Note, NoteInput } from '@ict/contracts';
import type { Db } from '../../infra/db/index.js';

const COLUMNS = 'id, title, body, subject, created_at AS createdAt, updated_at AS updatedAt';

// Every query names the owner, so one student can never reach another's notes.
export class NoteRepository {
  constructor(private readonly db: Db) {}

  insert(id: string, studentId: string, n: NoteInput, now: number) {
    this.db
      .prepare('INSERT INTO student_notes (id, student_id, title, body, subject, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(id, studentId, n.title, n.body, n.subject, now, now);
  }

  // Returns false when the note is missing or belongs to someone else.
  update(id: string, studentId: string, n: NoteInput, now: number): boolean {
    return this.db
      .prepare('UPDATE student_notes SET title = ?, body = ?, subject = ?, updated_at = ? WHERE id = ? AND student_id = ?')
      .run(n.title, n.body, n.subject, now, id, studentId).changes > 0;
  }

  remove(id: string, studentId: string): boolean {
    return this.db.prepare('DELETE FROM student_notes WHERE id = ? AND student_id = ?').run(id, studentId).changes > 0;
  }

  get(id: string, studentId: string): Note | undefined {
    return this.db.prepare(`SELECT ${COLUMNS} FROM student_notes WHERE id = ? AND student_id = ?`).get(id, studentId) as Note | undefined;
  }

  list(studentId: string): Note[] {
    return this.db
      .prepare(`SELECT ${COLUMNS} FROM student_notes WHERE student_id = ? ORDER BY updated_at DESC, created_at DESC`)
      .all(studentId) as Note[];
  }

  count(studentId: string): number {
    return this.db.prepare('SELECT COUNT(*) FROM student_notes WHERE student_id = ?').pluck().get(studentId) as number;
  }
}
