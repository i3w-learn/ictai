import type { RunParticipant, RunStatus, RunSummary } from '@ict/contracts';
import type { Db } from '../../infra/db/index.js';

export interface RunRow {
  id: string;
  quiz_id: string;
  class_id: string;
  status: RunStatus;
  started_at: number | null;
}

const RUN_COLUMNS = 'id, quiz_id, class_id, status, started_at';

// `choice` is TIMED_OUT for a question whose time ran out; `answered_at` is then its deadline.
export interface AnswerRow {
  question_index: number;
  choice: number;
  points: number;
  answered_at: number;
}

export class RunRepository {
  constructor(private readonly db: Db) {}

  insert(r: { id: string; quizId: string; classId: string; openedBy: string; now: number }) {
    this.db
      // join_code is left from when students typed a code to join; it is no longer used.
      .prepare(`INSERT INTO quiz_runs (id, quiz_id, class_id, join_code, status, opened_by, created_at) VALUES (?, ?, ?, '', 'lobby', ?, ?)`)
      .run(r.id, r.quizId, r.classId, r.openedBy, r.now);
  }

  get(id: string): RunRow | undefined {
    return this.db.prepare(`SELECT ${RUN_COLUMNS} FROM quiz_runs WHERE id = ?`).get(id) as RunRow | undefined;
  }

  // Runs still open for a class that this student has not handed in, newest first.
  openForStudent(classId: string, studentId: string): { id: string; quiz_id: string; status: RunRow['status'] }[] {
    return this.db
      .prepare(
        `SELECT r.id, r.quiz_id, r.status FROM quiz_runs r
         WHERE r.class_id = ? AND r.status != 'ended'
           AND NOT EXISTS (SELECT 1 FROM quiz_participants p WHERE p.run_id = r.id AND p.student_id = ? AND p.finished_at IS NOT NULL)
         ORDER BY r.created_at DESC`,
      )
      .all(classId, studentId) as { id: string; quiz_id: string; status: RunRow['status'] }[];
  }

  hasOpenRun(quizId: string): boolean {
    return !!this.db.prepare(`SELECT 1 FROM quiz_runs WHERE quiz_id = ? AND status != 'ended'`).get(quizId);
  }

  start(id: string, now: number, totalMarks: number) {
    this.db.prepare(`UPDATE quiz_runs SET status = 'active', started_at = ?, total_marks = ? WHERE id = ? AND status = 'lobby'`).run(now, totalMarks, id);
  }

  end(id: string, now: number) {
    this.db.prepare(`UPDATE quiz_runs SET status = 'ended', ended_at = ? WHERE id = ? AND status != 'ended'`).run(now, id);
  }

  listByQuiz(quizId: string): Omit<RunSummary, 'title'>[] {
    const rows = this.db
      .prepare(
        `SELECT r.id, r.quiz_id AS quizId, r.status, r.created_at AS createdAt,
           (SELECT COUNT(*) FROM quiz_participants p WHERE p.run_id = r.id) AS participants
         FROM quiz_runs r WHERE r.quiz_id = ? ORDER BY r.created_at DESC`,
      )
      .all(quizId) as Omit<RunSummary, 'title'>[];
    return rows;
  }

  addParticipant(runId: string, studentId: string, deviceId: string, now: number) {
    this.db
      .prepare('INSERT OR IGNORE INTO quiz_participants (run_id, student_id, device_id, joined_at) VALUES (?, ?, ?, ?)')
      .run(runId, studentId, deviceId, now);
  }

  participant(runId: string, studentId: string): { joined_at: number; finished_at: number | null } | undefined {
    return this.db
      .prepare('SELECT joined_at, finished_at FROM quiz_participants WHERE run_id = ? AND student_id = ?')
      .get(runId, studentId) as { joined_at: number; finished_at: number | null } | undefined;
  }

  // Students still working on the run.
  unfinishedIds(runId: string): string[] {
    return this.db
      .prepare('SELECT student_id FROM quiz_participants WHERE run_id = ? AND finished_at IS NULL')
      .pluck()
      .all(runId) as string[];
  }

  finish(runId: string, studentId: string, now: number) {
    this.db
      .prepare('UPDATE quiz_participants SET finished_at = ? WHERE run_id = ? AND student_id = ? AND finished_at IS NULL')
      .run(now, runId, studentId);
  }

  // Highest score first, then by name. A question that ran out of time is not an answer.
  participants(runId: string): RunParticipant[] {
    const rows = this.db
      .prepare(
        `SELECT p.student_id AS studentId, s.name, s.roll_no AS rollNo, p.finished_at AS finishedAt,
           COALESCE(SUM(a.choice >= 0), 0) AS answered,
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

  answers(runId: string, studentId: string): AnswerRow[] {
    return this.db
      .prepare('SELECT question_index, choice, points, answered_at FROM quiz_answers WHERE run_id = ? AND student_id = ?')
      .all(runId, studentId) as AnswerRow[];
  }
}
