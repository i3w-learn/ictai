import type { TeacherActivity } from '@ict/contracts';
import type { Db } from '../../infra/db/index.js';

export interface Attempt {
  studentId: string;
  runId: string;
  quizTitle: string;
  subject: string | null;
  topic: string | null;
  at: number;
  score: number;
  totalMarks: number;
}

export interface StudentInfo {
  id: string;
  name: string;
  rollNo: string | null;
  classId: string;
  className: string;
  sectionName: string | null;
}

// Which students: one class, and/or the classes a teacher may see (null means every class).
export interface ClassFilter {
  classId?: string;
  classIds?: string[] | null;
}

const STUDENT_COLUMNS = `s.id, s.name, s.roll_no AS rollNo, s.class_id AS classId, c.name AS className, sec.name AS sectionName
  FROM students s JOIN classes c ON c.id = s.class_id LEFT JOIN sections sec ON sec.id = s.section_id`;

// The class part of a WHERE clause, done by the database rather than after loading every row.
function classWhere(f: ClassFilter): { sql: string; params: unknown[] } {
  const parts: string[] = [];
  const params: unknown[] = [];
  if (f.classId) {
    parts.push('s.class_id = ?');
    params.push(f.classId);
  }
  if (f.classIds) {
    parts.push(`s.class_id IN (${f.classIds.map(() => '?').join(', ') || 'NULL'})`);
    params.push(...f.classIds);
  }
  return { sql: parts.map((p) => ` AND ${p}`).join(''), params };
}

// Reads quiz results straight from the Lab Mode tables. An attempt counts once the run has ended
// or the student pressed Finish, so half-done scores never show. A run ended in the lobby never counts.
// The total is the one saved when the run started; runs from before that was saved use today's total.
export class ResultsRepository {
  constructor(private readonly db: Db) {}

  attempts(filter: ClassFilter & { studentId?: string }): Attempt[] {
    const cls = classWhere(filter);
    const student = filter.studentId ? { sql: ' AND s.id = ?', params: [filter.studentId] } : { sql: '', params: [] };
    const rows = this.db
      .prepare(
        `SELECT p.student_id AS studentId, r.id AS runId, q.title AS quizTitle, q.subject, q.topic,
           COALESCE(p.finished_at, r.ended_at) AS at, q.questions_json AS questions, r.total_marks AS savedTotal,
           COALESCE((SELECT SUM(a.points) FROM quiz_answers a WHERE a.run_id = p.run_id AND a.student_id = p.student_id), 0) AS score
         FROM quiz_participants p
         JOIN quiz_runs r ON r.id = p.run_id
         JOIN quizzes q ON q.id = r.quiz_id
         JOIN students s ON s.id = p.student_id
         WHERE s.status = 'active' AND r.started_at IS NOT NULL AND (r.status = 'ended' OR p.finished_at IS NOT NULL)${cls.sql}${student.sql}
         ORDER BY at DESC`,
      )
      .all(...cls.params, ...student.params) as (Omit<Attempt, 'totalMarks'> & { questions: string; savedTotal: number | null })[];
    return rows.map(({ questions, savedTotal, ...r }) => ({
      ...r,
      totalMarks: savedTotal ?? (JSON.parse(questions) as { marks: number }[]).reduce((n, q) => n + q.marks, 0),
    }));
  }

  students(filter: ClassFilter = {}): StudentInfo[] {
    const cls = classWhere(filter);
    return this.db
      .prepare(`SELECT ${STUDENT_COLUMNS} WHERE s.status = 'active'${cls.sql} ORDER BY c.name COLLATE NOCASE, s.name COLLATE NOCASE`)
      .all(...cls.params) as StudentInfo[];
  }

  student(id: string): StudentInfo | undefined {
    return this.db.prepare(`SELECT ${STUDENT_COLUMNS} WHERE s.status = 'active' AND s.id = ?`).get(id) as StudentInfo | undefined;
  }

  teacherActivity(): TeacherActivity[] {
    return this.db
      .prepare(
        `SELECT u.id, u.display_name AS displayName, u.username, u.role,
           (SELECT COUNT(*) FROM quizzes q WHERE q.created_by = u.id AND q.status = 'active') AS quizzesMade,
           (SELECT COUNT(*) FROM quiz_runs r WHERE r.opened_by = u.id) AS runsHeld,
           (SELECT COUNT(DISTINCT p.student_id) FROM quiz_participants p JOIN quiz_runs r ON r.id = p.run_id WHERE r.opened_by = u.id) AS studentsReached,
           (SELECT MAX(l.at) FROM audit_log l WHERE l.actor_id = u.id AND l.action = 'signin') AS lastSignInAt
         FROM users u WHERE u.status != 'deleted'
         ORDER BY u.display_name COLLATE NOCASE`,
      )
      .all() as TeacherActivity[];
  }
}
