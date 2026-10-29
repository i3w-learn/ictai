import type { Question, Quiz, QuizInput, QuizSummary } from '@ict/contracts';
import type { Db } from '../../infra/db/index.js';

interface QuizRow {
  id: string;
  title: string;
  class_id: string;
  subject: string | null;
  topic: string | null;
  seconds_per_question: number;
  questions_json: string;
  updated_at: number;
}

const COLUMNS = 'id, title, class_id, subject, topic, seconds_per_question, questions_json, updated_at';

export const totalMarks = (qs: Question[]) => qs.reduce((n, q) => n + q.marks, 0);

const toQuiz = (r: QuizRow): Quiz => {
  const questions = JSON.parse(r.questions_json) as Question[];
  return {
    id: r.id, title: r.title, classId: r.class_id, subject: r.subject, topic: r.topic,
    secondsPerQuestion: r.seconds_per_question, questions, totalMarks: totalMarks(questions), updatedAt: r.updated_at,
  };
};

export class QuizRepository {
  constructor(private readonly db: Db) {}

  insert(id: string, q: QuizInput, createdBy: string, now: number) {
    this.db
      .prepare(
        `INSERT INTO quizzes (id, title, class_id, subject, topic, seconds_per_question, questions_json, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, q.title, q.classId, q.subject, q.topic, q.secondsPerQuestion, JSON.stringify(q.questions), createdBy, now, now);
  }

  replace(id: string, q: QuizInput, now: number) {
    this.db
      .prepare(
        `UPDATE quizzes SET title = ?, class_id = ?, subject = ?, topic = ?, seconds_per_question = ?, questions_json = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(q.title, q.classId, q.subject, q.topic, q.secondsPerQuestion, JSON.stringify(q.questions), now, id);
  }

  get(id: string, opts: { includeDeleted?: boolean } = {}): Quiz | undefined {
    const where = opts.includeDeleted ? 'id = ?' : `id = ? AND status = 'active'`;
    const row = this.db.prepare(`SELECT ${COLUMNS} FROM quizzes WHERE ${where}`).get(id) as QuizRow | undefined;
    return row && toQuiz(row);
  }

  list(classId?: string): QuizSummary[] {
    const rows = (
      classId
        ? this.db.prepare(`SELECT ${COLUMNS} FROM quizzes WHERE status = 'active' AND class_id = ? ORDER BY updated_at DESC`).all(classId)
        : this.db.prepare(`SELECT ${COLUMNS} FROM quizzes WHERE status = 'active' ORDER BY updated_at DESC`).all()
    ) as QuizRow[];
    return rows.map((r) => {
      const { questions, ...rest } = toQuiz(r);
      return {
        id: rest.id, title: rest.title, classId: rest.classId, subject: rest.subject, topic: rest.topic,
        questionCount: questions.length, totalMarks: rest.totalMarks, updatedAt: rest.updatedAt,
      };
    });
  }

  markDeleted(id: string, now: number) {
    this.db.prepare(`UPDATE quizzes SET status = 'deleted', updated_at = ? WHERE id = ?`).run(now, id);
  }
}
