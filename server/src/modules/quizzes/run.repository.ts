import type { RunMode, RunParticipant, RunStatus, RunSummary } from '@ict/contracts';
import type { Db } from '../../infra/db/index.js';

export interface RunRow {
  id: string;
  quiz_id: string;
  class_id: string;
  status: RunStatus;
  started_at: number | null;
  mode: RunMode;
  teams: number; // 0 = no teams
}

const RUN_COLUMNS = 'id, quiz_id, class_id, status, started_at, mode, teams';

// One student in a run. best_score is the best of the tries finished before the one being answered now.
export interface ParticipantRow {
  joined_at: number;
  finished_at: number | null;
  team: number | null;
  tries: number;
  best_score: number | null;
}

// `choice` is TIMED_OUT for a question whose time ran out; `answered_at` is then its deadline.
export interface AnswerRow {
  question_index: number;
  choice: number;
  points: number;
  answered_at: number;
}

// The best score over the tries finished earlier and the one just finished (null when none is).
export const bestOf = (before: number | null, finishedNow: number | null): number | null =>
  before == null ? finishedNow : finishedNow == null ? before : Math.max(before, finishedNow);

export class RunRepository {
  constructor(private readonly db: Db) {}

  insert(r: { id: string; quizId: string; classId: string; openedBy: string; now: number; mode: RunMode; teams: number }) {
    this.db
      // join_code is left from when students typed a code to join; it is no longer used.
      .prepare(`INSERT INTO quiz_runs (id, quiz_id, class_id, join_code, status, opened_by, created_at, mode, teams) VALUES (?, ?, ?, '', 'lobby', ?, ?, ?, ?)`)
      .run(r.id, r.quizId, r.classId, r.openedBy, r.now, r.mode, r.teams);
  }

  get(id: string): RunRow | undefined {
    return this.db.prepare(`SELECT ${RUN_COLUMNS} FROM quiz_runs WHERE id = ?`).get(id) as RunRow | undefined;
  }

  // Live runs still open for a class that this student has not handed in, newest first.
  // Practice is not here: it does not pop up on the student's screen (see practiceForClass).
  openForStudent(classId: string, studentId: string): { id: string; quiz_id: string; status: RunRow['status'] }[] {
    return this.db
      .prepare(
        `SELECT r.id, r.quiz_id, r.status FROM quiz_runs r
         WHERE r.class_id = ? AND r.status != 'ended' AND r.mode = 'live'
           AND NOT EXISTS (SELECT 1 FROM quiz_participants p WHERE p.run_id = r.id AND p.student_id = ? AND p.finished_at IS NOT NULL)
         ORDER BY r.created_at DESC`,
      )
      .all(classId, studentId) as { id: string; quiz_id: string; status: RunRow['status'] }[];
  }

  // Practice quizzes a class can do right now, newest first.
  practiceForClass(classId: string): { id: string; quiz_id: string }[] {
    return this.db
      .prepare(`SELECT id, quiz_id FROM quiz_runs WHERE class_id = ? AND mode = 'practice' AND status = 'active' ORDER BY created_at DESC`)
      .all(classId) as { id: string; quiz_id: string }[];
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
        `SELECT r.id, r.quiz_id AS quizId, r.mode, r.status, r.created_at AS createdAt,
           (SELECT COUNT(*) FROM quiz_participants p WHERE p.run_id = r.id) AS participants
         FROM quiz_runs r WHERE r.quiz_id = ? ORDER BY r.created_at DESC`,
      )
      .all(quizId) as Omit<RunSummary, 'title'>[];
    return rows;
  }

  // A student who is already in keeps their place and their team: joining again changes nothing.
  addParticipant(runId: string, studentId: string, deviceId: string, now: number, team: number | null) {
    this.db
      .prepare('INSERT OR IGNORE INTO quiz_participants (run_id, student_id, device_id, joined_at, team) VALUES (?, ?, ?, ?, ?)')
      .run(runId, studentId, deviceId, now, team);
  }

  // The team with the fewest students so far; the lowest number when several are level.
  smallestTeam(runId: string, teams: number): number {
    const rows = this.db.prepare('SELECT team, COUNT(*) AS n FROM quiz_participants WHERE run_id = ? AND team IS NOT NULL GROUP BY team').all(runId) as { team: number; n: number }[];
    const size = new Map(rows.map((r) => [r.team, r.n]));
    let best = 1;
    for (let team = 2; team <= teams; team++) if ((size.get(team) ?? 0) < (size.get(best) ?? 0)) best = team;
    return best;
  }

  participant(runId: string, studentId: string): ParticipantRow | undefined {
    return this.db
      .prepare('SELECT joined_at, finished_at, team, tries, best_score FROM quiz_participants WHERE run_id = ? AND student_id = ?')
      .get(runId, studentId) as ParticipantRow | undefined;
  }

  // Practice: wipes the answers of the try just finished and starts the next one. `best` is the best
  // score so far, with that try counted in.
  retry(runId: string, studentId: string, best: number, now: number) {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM quiz_answers WHERE run_id = ? AND student_id = ?').run(runId, studentId);
      this.db
        .prepare('UPDATE quiz_participants SET best_score = ?, tries = tries + 1, finished_at = NULL, joined_at = ? WHERE run_id = ? AND student_id = ?')
        .run(best, now, runId, studentId);
    })();
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
           p.team, p.tries, p.best_score AS bestBefore,
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
      .all(runId) as (Omit<RunParticipant, 'finished' | 'best'> & { finishedAt: number | null; bestBefore: number | null })[];
    return rows.map(({ finishedAt, bestBefore, ...r }) => ({
      ...r, finished: finishedAt != null, best: bestOf(bestBefore, finishedAt != null ? r.score : null),
    }));
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
