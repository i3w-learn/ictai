import type { Band, ResultsOverview, StudentResults, SubjectRow, TeacherActivity } from '@ict/contracts';
import { notFound } from '../../core/errors.js';
import type { Attempt, ResultsRepository } from './results.repository.js';
import { averageOf, bandOf, gradeOf, percentOf } from './rules.js';

const BAND_ORDER: Record<Band, number> = { needs: 0, growing: 1, great: 2, none: 3 };
const pct = (a: Attempt) => percentOf(a.score, a.totalMarks);

// Spec 4.4: how students are doing, from Lab Mode quiz results.
export class ResultsService {
  constructor(private readonly repo: ResultsRepository) {}

  overview(classId?: string): ResultsOverview {
    const attempts = this.repo.attempts({ classId });
    const byStudent = new Map<string, number[]>();
    for (const a of attempts) byStudent.set(a.studentId, [...(byStudent.get(a.studentId) ?? []), pct(a)]);

    const counts = { great: 0, growing: 0, needs: 0, none: 0 };
    const students = this.repo.students(classId).map((s) => {
      const percents = byStudent.get(s.id) ?? [];
      const average = averageOf(percents);
      const band = bandOf(average);
      counts[band]++;
      return { ...s, attempts: percents.length, average, band };
    });
    students.sort((a, b) => BAND_ORDER[a.band] - BAND_ORDER[b.band]);
    return { classAverage: averageOf(attempts.map(pct)), counts, students };
  }

  student(id: string): StudentResults {
    const s = this.repo.student(id);
    if (!s) throw notFound('Student');
    const attempts = this.repo.attempts({ studentId: id });
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
