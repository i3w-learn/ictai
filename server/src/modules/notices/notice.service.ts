import { randomUUID } from 'node:crypto';
import type { Notice, NoticeInput, StaffPrincipal, StudentPrincipal } from '@ict/contracts';
import type { AuditLog } from '../../core/audit.js';
import type { Clock } from '../../core/clock.js';
import { AppError, forbidden, notFound } from '../../core/errors.js';
import { checkMyClass, scopeOf, seesClass, type Scope } from '../../core/scope.js';
import type { ClassRepository } from '../students/class.repository.js';
import type { NoticeRepository } from './notice.repository.js';

// PRD "Notices": staff put up one-way messages; students read the ones meant for them.
// A teacher limited to some classes writes for those classes only. A notice for the whole school
// reaches every student, so only staff who see every class (the Super Admin) may write one.
export class NoticeService {
  constructor(
    private readonly now: Clock,
    private readonly notices: NoticeRepository,
    private readonly classes: ClassRepository,
    private readonly audit: AuditLog,
  ) {}

  // A limited teacher still reads school-wide notices (her students get them), but cannot change them.
  list(actor: StaffPrincipal): Notice[] {
    const scope = scopeOf(actor);
    return this.notices.all(this.now()).filter((n) => n.classId === null || seesClass(scope, n.classId));
  }

  create(actor: StaffPrincipal, input: NoticeInput): Notice {
    this.checkTarget(scopeOf(actor), input);
    const id = randomUUID();
    this.notices.insert(id, input, actor.userId, this.now());
    this.audit.record({ kind: 'staff', id: actor.userId }, 'notice.create', id, { title: input.title });
    return this.notices.get(id, this.now())!;
  }

  replace(actor: StaffPrincipal, id: string, input: NoticeInput): Notice {
    const scope = scopeOf(actor);
    this.mine(scope, id);
    this.checkTarget(scope, input);
    this.notices.update(id, input, this.now());
    return this.notices.get(id, this.now())!;
  }

  remove(actor: StaffPrincipal, id: string) {
    const notice = this.mine(scopeOf(actor), id);
    this.notices.remove(id);
    this.audit.record({ kind: 'staff', id: actor.userId }, 'notice.delete', id, { title: notice.title });
  }

  forStudent(me: StudentPrincipal): Notice[] {
    return this.notices.forStudent(me.classId, me.sectionId, this.now());
  }

  // The notice must exist and be one this person may change. One they cannot see looks missing.
  private mine(scope: Scope, id: string): Notice {
    const notice = this.notices.get(id, this.now());
    if (!notice || (notice.classId !== null && !seesClass(scope, notice.classId))) throw notFound('Notice');
    if (notice.classId === null && scope.classIds) throw forbidden('Only the Super Admin can change a notice for the whole school.');
    return notice;
  }

  private checkTarget(scope: Scope, n: NoticeInput) {
    if (n.expiresAt !== null && n.expiresAt <= this.now()) throw new AppError(400, 'BAD_REQUEST', 'Pick a time in the future for "Show until".');
    if (n.classId === null) {
      if (scope.classIds) throw forbidden('Only the Super Admin can write a notice for the whole school. Pick one of your classes.');
      return;
    }
    checkMyClass(this.classes, scope, n.classId);
    if (n.sectionId !== null && !this.classes.listSections(n.classId).some((s) => s.id === n.sectionId)) {
      throw new AppError(400, 'BAD_REQUEST', 'That section is not in this class.');
    }
  }
}
