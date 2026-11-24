import { RATING_MAX, type Poll, type PollKind } from '@ict/contracts';
import type { Db } from '../../infra/db/index.js';

interface Row {
  id: string; classId: string; className: string; question: string; kind: PollKind;
  options_json: string; closed_at: number | null; byName: string; createdAt: number;
}

const SELECT = `
  SELECT p.id, p.class_id AS classId, c.name AS className, p.question, p.kind, p.options_json, p.closed_at, u.display_name AS byName, p.created_at AS createdAt
  FROM polls p JOIN classes c ON c.id = p.class_id JOIN users u ON u.id = p.created_by`;

export class PollRepository {
  constructor(private readonly db: Db) {}

  insert(p: { id: string; classId: string; question: string; kind: PollKind; options: string[]; by: string; now: number }) {
    this.db
      .prepare('INSERT INTO polls (id, class_id, question, kind, options_json, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(p.id, p.classId, p.question, p.kind, JSON.stringify(p.options), p.by, p.now);
  }

  get(id: string): Poll | undefined {
    const row = this.db.prepare(`${SELECT} WHERE p.id = ?`).get(id) as Row | undefined;
    return row && this.withCounts(row);
  }

  // Newest first. For one class, or for every class.
  list(classId: string | undefined, limit: number): Poll[] {
    const rows = (classId
      ? this.db.prepare(`${SELECT} WHERE p.class_id = ? ORDER BY p.created_at DESC, p.rowid DESC LIMIT ?`).all(classId, limit)
      : this.db.prepare(`${SELECT} ORDER BY p.created_at DESC, p.rowid DESC LIMIT ?`).all(limit)) as Row[];
    return rows.map((r) => this.withCounts(r));
  }

  // The poll a class can answer right now. There is never more than one.
  openFor(classId: string): Poll | undefined {
    const row = this.db.prepare(`${SELECT} WHERE p.class_id = ? AND p.closed_at IS NULL ORDER BY p.created_at DESC, p.rowid DESC LIMIT 1`).get(classId) as Row | undefined;
    return row && this.withCounts(row);
  }

  close(id: string, now: number) {
    this.db.prepare('UPDATE polls SET closed_at = ? WHERE id = ? AND closed_at IS NULL').run(now, id);
  }

  closeAllFor(classId: string, now: number) {
    this.db.prepare('UPDATE polls SET closed_at = ? WHERE class_id = ? AND closed_at IS NULL').run(now, classId);
  }

  remove(id: string) {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM poll_answers WHERE poll_id = ?').run(id);
      this.db.prepare('DELETE FROM polls WHERE id = ?').run(id);
    })();
  }

  // One answer per student; answering again replaces it.
  answer(pollId: string, studentId: string, choice: number, now: number) {
    this.db
      .prepare(
        `INSERT INTO poll_answers (poll_id, student_id, choice, answered_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (poll_id, student_id) DO UPDATE SET choice = excluded.choice, answered_at = excluded.answered_at`,
      )
      .run(pollId, studentId, choice, now);
  }

  choiceOf(pollId: string, studentId: string): number | null {
    return (this.db.prepare('SELECT choice FROM poll_answers WHERE poll_id = ? AND student_id = ?').pluck().get(pollId, studentId) as number | undefined) ?? null;
  }

  private withCounts(r: Row): Poll {
    const options = JSON.parse(r.options_json) as string[];
    const rating = r.kind === 'rating';
    const counts = new Array<number>(rating ? RATING_MAX : options.length).fill(0);
    const rows = this.db.prepare('SELECT choice, COUNT(*) AS n FROM poll_answers WHERE poll_id = ? GROUP BY choice').all(r.id) as { choice: number; n: number }[];
    // A rating is stored as its number of stars (1 to 5); a choice as the option's place (from 0).
    for (const { choice, n } of rows) {
      const at = rating ? choice - 1 : choice;
      if (at >= 0 && at < counts.length) counts[at] = n;
    }
    const answered = counts.reduce((a, b) => a + b, 0);
    const stars = counts.reduce((sum, n, i) => sum + n * (i + 1), 0);
    return {
      id: r.id, classId: r.classId, className: r.className, question: r.question, kind: r.kind, options,
      open: r.closed_at === null, counts, answered,
      average: rating && answered > 0 ? Math.round((stars / answered) * 10) / 10 : null,
      byName: r.byName, createdAt: r.createdAt,
    };
  }
}
