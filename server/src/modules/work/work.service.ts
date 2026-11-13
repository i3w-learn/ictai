import { randomUUID } from 'node:crypto';
import { MAX_TRIES, type Assignment, type AssignmentDetail, type AssignmentInput, type MarkInput, type MyWork, type StaffPrincipal, type StudentPrincipal } from '@ict/contracts';
import type { AuditLog } from '../../core/audit.js';
import type { Clock } from '../../core/clock.js';
import { AppError, notFound } from '../../core/errors.js';
import { checkMyClass, checkSubject, scopeOf, seesQuiz, type Scope } from '../../core/scope.js';
import type { ClassRepository } from '../students/class.repository.js';
import type { WorkRepository } from './work.repository.js';

// PRD "Work" / "My work". A teacher works only with her own classes and subjects, as with quizzes.
// A student sees and answers only work set for their own class and section.
export class WorkService {
  constructor(
    private readonly now: Clock,
    private readonly work: WorkRepository,
    private readonly classes: ClassRepository,
    private readonly audit: AuditLog,
  ) {}

  list(actor: StaffPrincipal): Assignment[] {
    const scope = scopeOf(actor);
    return this.work.all().filter((a) => seesQuiz(scope, a));
  }

  create(actor: StaffPrincipal, input: AssignmentInput): Assignment {
    const scope = scopeOf(actor);
    checkMyClass(this.classes, scope, input.classId);
    checkSubject(scope, input.subject);
    if (input.sectionId !== null && !this.classes.sectionInClass(input.sectionId, input.classId)) {
      throw new AppError(400, 'BAD_REQUEST', 'That section is not in this class.');
    }
    if (input.dueAt !== null && input.dueAt <= this.now()) throw new AppError(400, 'BAD_REQUEST', 'Pick a due date in the future.');
    const id = randomUUID();
    this.work.insert(id, input, actor.userId, this.now());
    this.audit.record({ kind: 'staff', id: actor.userId }, 'work.set', id, { title: input.title });
    return this.work.get(id)!;
  }

  detail(actor: StaffPrincipal, id: string): AssignmentDetail {
    const assignment = this.mine(scopeOf(actor), id);
    return { assignment, answers: this.work.answers(id) };
  }

  remove(actor: StaffPrincipal, id: string) {
    const a = this.mine(scopeOf(actor), id);
    this.work.remove(id, this.now());
    this.audit.record({ kind: 'staff', id: actor.userId }, 'work.delete', id, { title: a.title });
  }

  mark(actor: StaffPrincipal, id: string, studentId: string, input: MarkInput): AssignmentDetail {
    const a = this.mine(scopeOf(actor), id);
    if (!this.work.isFor(id, studentId)) throw notFound('Student');
    if (input.marks > a.maxMarks) throw new AppError(400, 'BAD_REQUEST', `This work is out of ${a.maxMarks}. Give ${a.maxMarks} or fewer marks.`);
    if (!this.work.hasAnswer(id, studentId)) throw new AppError(409, 'NOT_HANDED_IN', 'This student has not handed in an answer yet.');
    this.work.setMark(id, studentId, input.marks, input.comment, actor.userId, this.now());
    return this.detail(actor, id);
  }

  mineAsStudent(me: StudentPrincipal): MyWork[] {
    return this.work.forStudent(me.studentId, this.now());
  }

  // Handing in again before the teacher has marked adds a new answer and keeps the old ones.
  submit(me: StudentPrincipal, id: string, body: string): MyWork {
    if (!this.work.isFor(id, me.studentId)) throw notFound('Work');
    if (this.work.isMarked(id, me.studentId)) throw new AppError(409, 'ALREADY_MARKED', 'Your teacher has already marked this. You cannot change your answer now.');
    const a = this.work.get(id)!;
    const now = this.now();
    // The same answer sent again changes nothing, so nothing new is stored.
    if (this.work.latestAnswer(id, me.studentId) === body) return this.work.forStudent(me.studentId, now, id)[0]!;
    if (this.work.tries(id, me.studentId) >= MAX_TRIES) {
      throw new AppError(409, 'TOO_MANY_TRIES', `You have handed this in ${MAX_TRIES} times. Your teacher has your last answer.`);
    }
    this.work.addAnswer(id, me.studentId, body, now, a.dueAt !== null && now > a.dueAt);
    return this.work.forStudent(me.studentId, now, id)[0]!;
  }

  // Work for a class or subject this person does not teach looks the same as work that is not there.
  private mine(scope: Scope, id: string): Assignment {
    const a = this.work.get(id);
    if (!a || !seesQuiz(scope, a)) throw notFound('Work');
    return a;
  }
}
