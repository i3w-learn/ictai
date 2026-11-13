import type { MyProgress, StudentPrincipal, TryNext } from '@ict/contracts';
import type { Clock } from '../../core/clock.js';
import type { WorkRepository } from '../work/work.repository.js';
import type { ResultsService } from './results.service.js';

// A subject at or above this is "doing great" and is not suggested for practice.
const GREAT = 75;
const EVERYTHING = { classIds: null, subjects: null };

// PRD "How I am doing". Built from what the server already knows about this one student:
// their quiz results and their marked work. Nothing here can show another student's data,
// because every query is asked with the signed-in student's own id.
export class ProgressService {
  constructor(
    private readonly now: Clock,
    private readonly results: ResultsService,
    private readonly work: WorkRepository,
  ) {}

  mine(me: StudentPrincipal): MyProgress {
    const r = this.results.student(EVERYTHING, me.studentId);
    const work = this.work.forStudent(me.studentId, this.now());
    const marked = work.filter((w) => w.mark);
    const possible = marked.reduce((n, w) => n + w.maxMarks, 0);
    const earned = marked.reduce((n, w) => n + w.mark!.marks, 0);

    const overdue = work.filter((w) => w.overdue).sort((a, b) => a.dueAt! - b.dueAt!)[0];
    const weakest = [...r.subjects].sort((a, b) => a.average - b.average)[0];
    const tryNext: TryNext | null = overdue
      ? { kind: 'work', title: overdue.title }
      : weakest && weakest.average < GREAT
        ? { kind: 'subject', subject: weakest.subject, average: weakest.average }
        : null;

    return {
      quizzes: { taken: r.attempts, average: r.average, grade: r.grade },
      subjects: r.subjects,
      recent: r.history.slice(0, 5),
      work: {
        set: work.length,
        handedIn: work.filter((w) => w.answer).length,
        onTime: work.filter((w) => w.answer && !w.answer.late).length,
        marked: marked.length,
        marksPercent: possible > 0 ? Math.round((earned / possible) * 100) : null,
      },
      tryNext,
    };
  }
}
