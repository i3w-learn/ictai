import type { ActivityScore, MyActivityBest } from '@ict/contracts';
import type { Db } from '../../infra/db/index.js';

export class ActivityRepository {
  constructor(private readonly db: Db) {}

  add(r: { contentId: string; studentId: string; score: number; max: number; seconds: number; now: number }) {
    this.db
      .prepare('INSERT INTO activity_results (content_id, student_id, score, max, seconds, done_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(r.contentId, r.studentId, r.score, r.max, r.seconds, r.now);
  }

  // The best try is the one with the biggest share of the marks.
  bestOf(contentId: string, studentId: string): MyActivityBest | undefined {
    const row = this.db
      .prepare(
        `SELECT score AS best, max, (SELECT COUNT(*) FROM activity_results WHERE content_id = ? AND student_id = ?) AS tries
         FROM activity_results WHERE content_id = ? AND student_id = ?
         ORDER BY CAST(score AS REAL) / max DESC, done_at DESC LIMIT 1`,
      )
      .get(contentId, studentId, contentId, studentId) as MyActivityBest | undefined;
    return row;
  }

  // Every active student of the class in roll order, with their best try if they have one.
  forClass(contentId: string, classId: string): ActivityScore[] {
    const students = this.db
      .prepare(`SELECT id AS studentId, name, roll_no AS rollNo FROM students WHERE class_id = ? AND status = 'active' ORDER BY CAST(roll_no AS INTEGER), roll_no, name`)
      .all(classId) as { studentId: string; name: string; rollNo: string | null }[];
    const last = this.db.prepare('SELECT MAX(done_at) FROM activity_results WHERE content_id = ? AND student_id = ?').pluck();
    return students.map((s) => {
      const best = this.bestOf(contentId, s.studentId);
      return { ...s, best: best?.best ?? null, max: best?.max ?? null, tries: best?.tries ?? 0, lastAt: best ? (last.get(contentId, s.studentId) as number) : null };
    });
  }
}
