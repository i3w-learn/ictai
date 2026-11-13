import { randomUUID } from 'node:crypto';
import type { ContentItem, Sequence, SequenceInput, SequenceStep, StaffPrincipal, StudentPrincipal, Todo } from '@ict/contracts';
import type { AuditLog } from '../../core/audit.js';
import type { Clock } from '../../core/clock.js';
import { AppError, notFound } from '../../core/errors.js';
import { checkMyClass, checkSubject, scopeOf, seesQuiz } from '../../core/scope.js';
import type { ContentRepository } from '../content/content.repository.js';
import type { ClassRepository } from '../students/class.repository.js';
import type { WorkRepository } from '../work/work.repository.js';
import type { SequenceRepository, SequenceRow, StepRow } from './sequence.repository.js';

// PRD "Playlists", "Learning paths" and the student's "Things to do".
// Every step must come from the same class as the playlist or path, so a student never meets a step
// they cannot open. A teacher makes them only for her own classes and subjects.
export class SequenceService {
  constructor(
    private readonly now: Clock,
    private readonly sequences: SequenceRepository,
    private readonly content: ContentRepository,
    private readonly work: WorkRepository,
    private readonly classes: ClassRepository,
    private readonly audit: AuditLog,
  ) {}

  list(actor: StaffPrincipal): Sequence[] {
    const scope = scopeOf(actor);
    const rows = this.sequences.all().filter((q) => seesQuiz(scope, q));
    const steps = this.stepsOf(rows);
    return rows.map((q) => {
      const mine = steps.get(q.id) ?? [];
      const students = this.sequences.classStudents(q.classId);
      const finished = q.type === 'path' ? students.filter((id) => this.isFinished(mine, id)).length : 0;
      return { ...q, steps: mine, students: students.length, finished };
    });
  }

  create(actor: StaffPrincipal, input: SequenceInput): Sequence {
    const scope = scopeOf(actor);
    checkMyClass(this.classes, scope, input.classId);
    checkSubject(scope, input.subject);
    for (const [i, step] of input.steps.entries()) {
      const where = `Step ${i + 1}`;
      if (step.kind === 'content') {
        const item = this.content.get(step.refId);
        if (!item || item.classId !== input.classId) throw new AppError(400, 'BAD_REQUEST', `${where}: pick an item from this class's library.`);
      } else {
        if (input.type === 'playlist') throw new AppError(400, 'BAD_REQUEST', `${where}: a playlist holds library items only. Use a learning path to add work.`);
        const a = this.work.get(step.refId);
        if (!a || a.classId !== input.classId) throw new AppError(400, 'BAD_REQUEST', `${where}: pick a piece of work set for this class.`);
      }
    }
    const id = randomUUID();
    this.sequences.insert({ id, type: input.type, title: input.title, classId: input.classId, subject: input.subject, by: actor.userId, now: this.now() }, input.steps.map((s) => ({ id: randomUUID(), ...s })));
    this.audit.record({ kind: 'staff', id: actor.userId }, `${input.type}.create`, id, { title: input.title });
    return this.list(actor).find((q) => q.id === id)!;
  }

  remove(actor: StaffPrincipal, id: string) {
    const q = this.sequences.get(id);
    if (!q || !seesQuiz(scopeOf(actor), q)) throw notFound(q?.type === 'path' ? 'Learning path' : 'Playlist');
    this.sequences.remove(id, this.now());
    this.audit.record({ kind: 'staff', id: actor.userId }, `${q.type}.delete`, id, { title: q.title });
  }

  // The student's "Things to do": their class's playlists and paths, with ticks.
  todo(me: StudentPrincipal): Todo[] {
    const rows = this.sequences.all(me.classId);
    const steps = this.stepsOf(rows);
    const opened = this.sequences.doneSteps(me.studentId);
    const handedIn = this.sequences.handedIn(me.studentId);
    return rows.map((q) => {
      const list = (steps.get(q.id) ?? []).map((s) => ({ ...s, done: s.kind === 'content' ? opened.has(s.id) : !!s.workId && handedIn.has(s.workId) }));
      return {
        id: q.id, type: q.type, title: q.title, subject: q.subject, byName: q.byName, steps: list,
        doneSteps: list.filter((s) => s.done).length,
        // The first step still to do that can be opened.
        nextStepId: list.find((s) => !s.done && s.available)?.id ?? null,
      };
    });
  }

  // Opening a library step counts as doing it. A work step is done by handing the work in, not here.
  markDone(me: StudentPrincipal, stepId: string) {
    const step = this.sequences.step(stepId);
    if (!step || step.classId !== me.classId) throw notFound('Step');
    if (step.kind !== 'content') throw new AppError(409, 'HAND_IN', 'This step is a piece of work. It is done when you hand it in.');
    this.sequences.markDone(stepId, me.studentId, this.now());
  }

  private stepsOf(rows: SequenceRow[]): Map<string, SequenceStep[]> {
    const raw = this.sequences.steps(rows.map((r) => r.id));
    const items = new Map<string, ContentItem | undefined>();
    for (const s of raw) if (s.contentId && !items.has(s.contentId)) items.set(s.contentId, this.content.get(s.contentId));
    const out = new Map<string, SequenceStep[]>();
    for (const s of raw) out.set(s.sequenceId, [...(out.get(s.sequenceId) ?? []), toStep(s, s.contentId ? items.get(s.contentId) : undefined)]);
    return out;
  }

  // A path is finished when every step that can still be opened is done.
  private isFinished(steps: SequenceStep[], studentId: string): boolean {
    const live = steps.filter((s) => s.available);
    if (live.length === 0) return false;
    const opened = this.sequences.doneSteps(studentId);
    const handedIn = this.sequences.handedIn(studentId);
    return live.every((s) => (s.kind === 'content' ? opened.has(s.id) : handedIn.has(s.workId!)));
  }
}

function toStep(s: StepRow, item: ContentItem | undefined): SequenceStep {
  if (s.kind === 'content') return { id: s.id, kind: 'content', title: item?.title ?? 'Removed from the library', content: item ?? null, workId: null, available: !!item };
  const there = s.workTitle !== null && s.workGone === null;
  return { id: s.id, kind: 'work', title: s.workTitle ?? 'Work that was taken away', content: null, workId: s.assignmentId, available: there };
}
