import type { Band, ResultsOverview, StudentResults, SubjectRow, TeacherActivity } from '@ict/contracts';
import { notFound } from '../../core/errors.js';
import { checkClass, checkMyClass, seesSubject, type Scope } from '../../core/scope.js';
import type { ClassRepository } from '../students/class.repository.js';
import type { Attempt, ResultsRepository } from './results.repository.js';
import { averageOf, bandOf, gradeOf, percentOf } from './rules.js';

const BAND_ORDER: Record<Band, number> = { needs: 0, growing: 1, great: 2, none: 3 };
const pct = (a: Attempt) => percentOf(a.score, a.totalMarks);

// Spec 4.4: how students are doing, from Lab Mode quiz results.
// A teacher sees only their own classes, and only quizzes in their own subjects count.
export class ResultsService {
  constructor(
    private readonly repo: ResultsRepository,
    private readonly classes: ClassRepository,
  ) {}

  overview(scope: Scope, classId?: string): ResultsOverview {
    if (classId) checkMyClass(this.classes, scope, classId);
    // The database keeps to the teacher's classes; only the subject match is done here.
    const filter = { classId, classIds: scope.classIds };
    const visible = this.repo.students(filter);
    const attempts = this.repo.attempts(filter).filter((a) => seesSubject(scope, a.subject));
    const byStudent = new Map<string, number[]>();
    for (const a of attempts) byStudent.set(a.studentId, [...(byStudent.get(a.studentId) ?? []), pct(a)]);

    const counts = { great: 0, growing: 0, needs: 0, none: 0 };
    const students = visible.map((s) => {
      const percents = byStudent.get(s.id) ?? [];
      const average = averageOf(percents);
      const band = bandOf(average);
      counts[band]++;
      return { ...s, attempts: percents.length, average, band };
    });
    students.sort((a, b) => BAND_ORDER[a.band] - BAND_ORDER[b.band]);
    return { classAverage: averageOf(attempts.map(pct)), counts, students };
  }

  student(scope: Scope, id: string): StudentResults {
    const s = this.repo.student(id);
    if (!s) throw notFound('Student');
    checkClass(scope, s.classId);
    const attempts = this.repo.attempts({ studentId: id }).filter((a) => seesSubject(scope, a.subject));
    const average = averageOf(attempts.map(pct));

    const bySubject = new Map<string, number[]>();
    for (const a of attempts) {
      const key = a.subject ?? 'No subject';
      bySubject.set(key, [...(bySubject.get(key) ?? []), pct(a)]);
    }
    const subjects: SubjectRow[] = [...bySubject].map(([subject, percents]) => {
      const avg = averageOf(percents)!;
      return { subject, attempts: percents.length, average: avg, grade: gradeOf(avg) };
    });
    subjects.sort((a, b) => b.average - a.average);

    return {
      student: { id: s.id, name: s.name, rollNo: s.rollNo, className: s.className, sectionName: s.sectionName },
      attempts: attempts.length,
      average,
      grade: average == null ? null : gradeOf(average),
      subjects,
      history: attempts.map(({ studentId: _, ...a }) => ({ ...a, percent: percentOf(a.score, a.totalMarks) })),
    };
  }

  teachers(): TeacherActivity[] {
    return this.repo.teacherActivity();
  }
}
