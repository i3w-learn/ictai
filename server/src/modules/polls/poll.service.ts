import { randomUUID } from 'node:crypto';
import { RATING_MAX, pollRoom, type Poll, type PollForStudent, type PollInput, type StaffPrincipal, type StudentPrincipal } from '@ict/contracts';
import type { AuditLog } from '../../core/audit.js';
import type { Clock } from '../../core/clock.js';
import { AppError, notFound } from '../../core/errors.js';
import { asStudent } from '../../core/route.js';
import { checkMyClass, scopeOf, seesClass } from '../../core/scope.js';
import type { Relay } from '../../relay/relay.js';
import type { ClassRepository } from '../students/class.repository.js';
import type { PollRepository } from './poll.repository.js';

// How many past polls a list shows.
const LIST_LIMIT = 30;

// Spec 4.3 "Polls": the teacher asks a class one question, every student's screen shows it, and the
// teacher watches the answers come in. A poll has no right answer and no score, and the teacher sees
// only how many chose what, never who.
// A class has one open poll at a time: asking a new one closes the one before.
export class PollService {
  constructor(
    private readonly now: Clock,
    private readonly polls: PollRepository,
    private readonly classes: ClassRepository,
    private readonly relay: Relay,
    private readonly audit: AuditLog,
  ) {
    relay.register({
      prefix: 'poll',
      // A student listens to their own class; a teacher to the classes she teaches.
      canJoin: (p, classId) => (p.kind === 'student' ? p.classId === classId : p.kind === 'staff' && seesClass(scopeOf(p), classId)),
      // A student gets the open poll with their own answer. Staff get the class's newest poll with its
      // counts, open or just closed.
      snapshot: (p, classId) => (p.kind === 'staff' ? (this.polls.list(classId, 1)[0] ?? null) : this.openFor(asStudent(p))),
    });
  }

  list(actor: StaffPrincipal, classId?: string): Poll[] {
    const scope = scopeOf(actor);
    if (classId) checkMyClass(this.classes, scope, classId);
    return this.polls.list(classId, LIST_LIMIT).filter((p) => seesClass(scope, p.classId));
  }

  ask(actor: StaffPrincipal, input: PollInput): Poll {
    checkMyClass(this.classes, scopeOf(actor), input.classId);
    const id = randomUUID();
    const now = this.now();
    this.polls.closeAllFor(input.classId, now);
    this.polls.insert({ id, classId: input.classId, question: input.question, kind: input.kind, options: input.options, by: actor.userId, now });
    this.audit.record({ kind: 'staff', id: actor.userId }, 'poll.ask', input.classId, { question: input.question, kind: input.kind });
    this.relay.notify(pollRoom(input.classId));
    return this.polls.get(id)!;
  }

  close(actor: StaffPrincipal, id: string): Poll {
    const poll = this.mine(actor, id);
    this.polls.close(id, this.now());
    this.relay.notify(pollRoom(poll.classId));
    return this.polls.get(id)!;
  }

  remove(actor: StaffPrincipal, id: string) {
    const poll = this.mine(actor, id);
    this.polls.remove(id);
    this.audit.record({ kind: 'staff', id: actor.userId }, 'poll.delete', poll.classId, { question: poll.question });
    this.relay.notify(pollRoom(poll.classId));
  }

  openFor(me: StudentPrincipal): PollForStudent | null {
    const poll = this.polls.openFor(me.classId);
    return poll ? this.forStudent(poll, me) : null;
  }

  answer(me: StudentPrincipal, id: string, choice: number): PollForStudent {
    const poll = this.polls.get(id);
    // A poll of another class looks missing: a student cannot find out what other classes are asked.
    if (!poll || poll.classId !== me.classId) throw notFound('Poll');
    if (!poll.open) throw new AppError(409, 'POLL_CLOSED', 'This question is closed.');
    const ok = poll.kind === 'rating' ? choice >= 1 && choice <= RATING_MAX : choice < poll.options.length;
    if (!ok) throw new AppError(400, 'BAD_REQUEST', 'Pick one of the answers on the screen.');
    this.polls.answer(id, me.studentId, choice, this.now());
    this.relay.notify(pollRoom(poll.classId));
    return this.forStudent(poll, me);
  }

  private forStudent(poll: Poll, me: StudentPrincipal): PollForStudent {
    return { id: poll.id, question: poll.question, kind: poll.kind, options: poll.options, myChoice: this.polls.choiceOf(poll.id, me.studentId) };
  }

  // The poll must exist and be for a class this person teaches. One she cannot see looks missing.
  private mine(actor: StaffPrincipal, id: string): Poll {
    const poll = this.polls.get(id);
    if (!poll || !seesClass(scopeOf(actor), poll.classId)) throw notFound('Poll');
    return poll;
  }
}
