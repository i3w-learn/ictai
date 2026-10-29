import type { RunParticipant, RunStatus, RunSummary } from '@ict/contracts';
import type { Db } from '../../infra/db/index.js';

export interface RunRow {
  id: string;
  quiz_id: string;
  class_id: string;
  join_code: string;
  status: RunStatus;
}

export class RunRepository {
  constructor(private readonly db: Db) {}

  insert(r: { id: string; quizId: string; classId: string; joinCode: string; openedBy: string; now: number }) {
    this.db
      .prepare(`INSERT INTO quiz_runs (id, quiz_id, class_id, join_code, status, opened_by, created_at) VALUES (?, ?, ?, ?, 'lobby', ?, ?)`)
      .run(r.id, r.quizId, r.classId, r.joinCode, r.openedBy, r.now);
  }

  get(id: string): RunRow | undefined {
    return this.db.prepare('SELECT id, quiz_id, class_id, join_code, status FROM quiz_runs WHERE id = ?').get(id) as RunRow | undefined;
  }

  // Codes are unique only among runs that are still open.
  findOpenByCode(code: string): RunRow | undefined {
    return this.db
      .prepare(`SELECT id, quiz_id, class_id, join_code, status FROM quiz_runs WHERE join_code = ? AND status != 'ended'`)
      .get(code) as RunRow | undefined;
  }

  hasOpenRun(quizId: string): boolean {
    return !!this.db.prepare(`SELECT 1 FROM quiz_runs WHERE quiz_id = ? AND status != 'ended'`).get(quizId);
  }

  start(id: string, now: number) {
    this.db.prepare(`UPDATE quiz_runs SET status = 'active', started_at = ? WHERE id = ? AND status = 'lobby'`).run(now, id);
  }

  end(id: string, now: number) {
    this.db.prepare(`UPDATE quiz_runs SET status = 'ended', ended_at = ? WHERE id = ? AND status != 'ended'`).run(now, id);
  }

  listByQuiz(quizId: string): Omit<RunSummary, 'title'>[] {
    const rows = this.db
      .prepare(
        `SELECT r.id, r.quiz_id AS quizId, r.status, r.join_code AS joinCode, r.created_at AS createdAt,
           (SELECT COUNT(*) FROM quiz_participants p WHERE p.run_id = r.id) AS participants
         FROM quiz_runs r WHERE r.quiz_id = ? ORDER BY r.created_at DESC`,
      )
      .all(quizId) as Omit<RunSummary, 'title'>[];
    return rows.map((r) => ({ ...r, joinCode: r.status === 'ended' ? null : r.joinCode }));
  }

  addParticipant(runId: string, studentId: string, deviceId: string, now: number) {
    this.db
      .prepare('INSERT OR IGNORE INTO quiz_participants (run_id, student_id, device_id, joined_at) VALUES (?, ?, ?, ?)')
      .run(runId, studentId, deviceId, now);
  }

  participant(runId: string, studentId: string): { finished_at: number | null } | undefined {
    return this.db
      .prepare('SELECT finished_at FROM quiz_participants WHERE run_id = ? AND student_id = ?')
      .get(runId, studentId) as { finished_at: number | null } | undefined;
  }

  finish(runId: string, studentId: string, now: number) {
    this.db
      .prepare('UPDATE quiz_participants SET finished_at = ? WHERE run_id = ? AND student_id = ? AND finished_at IS NULL')
      .run(now, runId, studentId);
  }

  // Highest score first, then by name.
  participants(runId: string): RunParticipant[] {
    const rows = this.db
      .prepare(
        `SELECT p.student_id AS studentId, s.name, s.roll_no AS rollNo, p.finished_at AS finishedAt,
           COUNT(a.question_index) AS answered,
           COALESCE(SUM(a.points > 0), 0) AS correct,
           COALESCE(SUM(a.points), 0) AS score
         FROM quiz_participants p
         JOIN students s ON s.id = p.student_id
         LEFT JOIN quiz_answers a ON a.run_id = p.run_id AND a.student_id = p.student_id
         WHERE p.run_id = ?
         GROUP BY p.student_id
         ORDER BY score DESC, s.name COLLATE NOCASE`,
      )
      .all(runId) as (Omit<RunParticipant, 'finished'> & { finishedAt: number | null })[];
    return rows.map(({ finishedAt, ...r }) => ({ ...r, finished: finishedAt != null }));
  }

  // Returns false when this question was already answered; the first answer stands.
  answer(a: { runId: string; studentId: string; questionIndex: number; choice: number; points: number; now: number }): boolean {
    return (
      this.db
        .prepare(
          `INSERT OR IGNORE INTO quiz_answers (run_id, student_id, question_index, choice, points, answered_at) VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(a.runId, a.studentId, a.questionIndex, a.choice, a.points, a.now).changes === 1
    );
  }

  answers(runId: string, studentId: string): { question_index: number; choice: number; points: number }[] {
    return this.db
      .prepare('SELECT question_index, choice, points FROM quiz_answers WHERE run_id = ? AND student_id = ?')
      .all(runId, studentId) as { question_index: number; choice: number; points: number }[];
  }
}
