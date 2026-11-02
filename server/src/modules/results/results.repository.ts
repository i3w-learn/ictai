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

const STUDENT_COLUMNS = `s.id, s.name, s.roll_no AS rollNo, s.class_id AS classId, c.name AS className, sec.name AS sectionName
  FROM students s JOIN classes c ON c.id = s.class_id LEFT JOIN sections sec ON sec.id = s.section_id`;

// Reads quiz results straight from the Lab Mode tables. An attempt counts once the run has ended
// or the student pressed Finish, so half-done scores never show.
export class ResultsRepository {
  constructor(private readonly db: Db) {}

  attempts(filter: { classId?: string; studentId?: string }): Attempt[] {
    const rows = this.db
      .prepare(
        `SELECT p.student_id AS studentId, r.id AS runId, q.title AS quizTitle, q.subject, q.topic,
           COALESCE(p.finished_at, r.ended_at) AS at, q.questions_json AS questions,
           COALESCE((SELECT SUM(a.points) FROM quiz_answers a WHERE a.run_id = p.run_id AND a.student_id = p.student_id), 0) AS score
         FROM quiz_participants p
         JOIN quiz_runs r ON r.id = p.run_id
         JOIN quizzes q ON q.id = r.quiz_id
         JOIN students s ON s.id = p.student_id
         WHERE s.status = 'active' AND (r.status = 'ended' OR p.finished_at IS NOT NULL)
           AND (@classId IS NULL OR s.class_id = @classId) AND (@studentId IS NULL OR s.id = @studentId)
         ORDER BY at DESC`,
      )
      .all({ classId: filter.classId ?? null, studentId: filter.studentId ?? null }) as (Omit<Attempt, 'totalMarks'> & { questions: string })[];
    return rows.map(({ questions, ...r }) => ({
      ...r,
      totalMarks: (JSON.parse(questions) as { marks: number }[]).reduce((n, q) => n + q.marks, 0),
    }));
  }

  students(classId?: string): StudentInfo[] {
    return this.db
      .prepare(`SELECT ${STUDENT_COLUMNS} WHERE s.status = 'active' AND (@classId IS NULL OR s.class_id = @classId)
                ORDER BY c.name COLLATE NOCASE, s.name COLLATE NOCASE`)
      .all({ classId: classId ?? null }) as StudentInfo[];
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
