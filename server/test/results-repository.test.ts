import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { openDb } from '../src/infra/db/index.js';
import { ResultsRepository } from '../src/modules/results/results.repository.js';

const QUESTIONS = JSON.stringify([
  { text: 'a', options: ['1', '2'], correct: 0, marks: 2 },
  { text: 'b', options: ['1', '2'], correct: 0, marks: 1 },
]);

function setup() {
  const db = openDb(':memory:');
  const id = () => randomUUID();
  const teacher = id();
  db.prepare(`INSERT INTO users (id, role, username, display_name, password_hash, created_at, updated_at) VALUES (?, 'teacher', 'priya', 'Priya', 'x', 0, 0)`).run(teacher);
  const classId = id();
  db.prepare(`INSERT INTO classes (id, name, created_at) VALUES (?, '7', 0)`).run(classId);
  const student = (name: string, status = 'active') => {
    const s = id();
    db.prepare(`INSERT INTO students (id, name, class_id, qr_token_hash, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 0, 0)`)
      .run(s, name, classId, randomUUID(), status);
    return s;
  };
  const quiz = id();
  db.prepare(`INSERT INTO quizzes (id, title, class_id, subject, seconds_per_question, questions_json, created_by, created_at, updated_at)
              VALUES (?, 'Fractions', ?, 'Maths', 60, ?, ?, 0, 0)`).run(quiz, classId, QUESTIONS, teacher);
  const run = (status: 'lobby' | 'active' | 'ended', endedAt: number | null = null, startedAt: number | null = status === 'lobby' ? null : 0) => {
    const r = id();
    db.prepare(`INSERT INTO quiz_runs (id, quiz_id, class_id, join_code, status, opened_by, created_at, started_at, ended_at) VALUES (?, ?, ?, '123456', ?, ?, 0, ?, ?)`)
      .run(r, quiz, classId, status, teacher, startedAt, endedAt);
    return r;
  };
  const join = (r: string, s: string, finishedAt: number | null = null) =>
    db.prepare(`INSERT INTO quiz_participants (run_id, student_id, device_id, joined_at, finished_at) VALUES (?, ?, 'd', 0, ?)`).run(r, s, finishedAt);
  const answer = (r: string, s: string, q: number, points: number) =>
    db.prepare(`INSERT INTO quiz_answers (run_id, student_id, question_index, choice, points, answered_at) VALUES (?, ?, ?, 0, ?, 0)`).run(r, s, q, points);
  return { db, repo: new ResultsRepository(db), teacher, classId, student, run, join, answer };
}

describe('results repository', () => {
  it('counts an ended run where the student answered nothing as 0', () => {
    const { repo, student, run, join } = setup();
    const s = student('Rohan');
    const r = run('ended', 500);
    join(r, s);
    expect(repo.attempts({ studentId: s })).toEqual([
      expect.objectContaining({ runId: r, score: 0, totalMarks: 3, at: 500, quizTitle: 'Fractions', subject: 'Maths' }),
    ]);
  });

  it('does not count an open run until the student finishes', () => {
    const { repo, student, run, join } = setup();
    const a = student('Asha');
    const b = student('Kabir');
    const r = run('active');
    join(r, a, 300);
    join(r, b);
    expect(repo.attempts({}).map((x) => x.studentId)).toEqual([a]);
    expect(repo.attempts({})[0]!.at).toBe(300);
  });

  it('does not count a run that was ended before it started', () => {
    const { repo, student, run, join } = setup();
    const s = student('Asha');
    join(run('ended', 5, null), s);
    expect(repo.attempts({ studentId: s })).toEqual([]);
  });

  it('sums points per attempt and reports the quiz total', () => {
    const { repo, student, run, join, answer } = setup();
    const s = student('Asha');
    const r = run('ended', 9);
    join(r, s);
    answer(r, s, 0, 2);
    answer(r, s, 1, 0);
    expect(repo.attempts({ studentId: s })[0]).toMatchObject({ score: 2, totalMarks: 3 });
  });

  it('uses the total saved when the run started, not the edited quiz', () => {
    const { db, repo, student, run, join, answer } = setup();
    const s = student('Asha');
    const r = run('ended', 9);
    db.prepare('UPDATE quiz_runs SET total_marks = 2 WHERE id = ?').run(r);
    join(r, s);
    answer(r, s, 0, 2);
    expect(repo.attempts({ studentId: s })[0]).toMatchObject({ score: 2, totalMarks: 2 });
  });

  it('leaves out deleted students', () => {
    const { repo, student, run, join, classId } = setup();
    const gone = student('Gone', 'deleted');
    join(run('ended', 1), gone);
    expect(repo.attempts({ classId })).toEqual([]);
    expect(repo.students({ classId })).toEqual([]);
    expect(repo.student(gone)).toBeUndefined();
  });

  it('teacherActivity counts quizzes, runs, distinct students and last sign-in', () => {
    const { db, repo, student, run, join, teacher } = setup();
    const s = student('Asha');
    join(run('ended', 1), s);
    join(run('ended', 2), s);
    db.prepare(`INSERT INTO audit_log (at, actor_kind, actor_id, action) VALUES (100, 'staff', ?, 'signin'), (200, 'staff', ?, 'signin')`).run(teacher, teacher);
    expect(repo.teacherActivity()).toEqual([
      { id: teacher, displayName: 'Priya', username: 'priya', role: 'teacher', quizzesMade: 1, runsHeld: 2, studentsReached: 1, lastSignInAt: 200 },
    ]);
  });
  it('filters students and attempts to a list of classes', () => {
    const { db, repo, student, run, join, classId } = setup();
    const other = randomUUID();
    db.prepare(`INSERT INTO classes (id, name, created_at) VALUES (?, '8', 0)`).run(other);
    const asha = student('Asha');
    const meera = randomUUID();
    db.prepare(`INSERT INTO students (id, name, class_id, qr_token_hash, status, created_at, updated_at) VALUES (?, 'Meera', ?, ?, 'active', 0, 0)`).run(meera, other, randomUUID());
    const r = run('ended', 500);
    join(r, asha);
    join(r, meera);
    expect(repo.students({ classIds: [classId] }).map((s) => s.name)).toEqual(['Asha']);
    expect(repo.attempts({ classIds: [classId] }).map((a) => a.studentId)).toEqual([asha]);
    expect(repo.students({ classIds: [other] }).map((s) => s.name)).toEqual(['Meera']);
    expect(repo.students({}).map((s) => s.name)).toEqual(['Asha', 'Meera']);
    expect(repo.attempts({}).length).toBe(2);
  });
});
