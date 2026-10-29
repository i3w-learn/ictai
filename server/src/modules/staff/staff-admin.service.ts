import type { NewTeacher, StaffMember, StaffPrincipal, UpdateTeacher } from '@ict/contracts';
import type { AuditLog } from '../../core/audit.js';
import type { Clock } from '../../core/clock.js';
import { forbidden, notFound, unique } from '../../core/errors.js';
import { hashSecret } from '../auth/secrets.js';
import type { SessionRepository } from '../auth/session.repository.js';
import type { StaffRepository, StaffRow } from '../auth/staff.repository.js';

const toStaffMember = (r: StaffRow): StaffMember => ({
  id: r.id,
  username: r.username,
  displayName: r.display_name,
  role: r.role,
  canHostLessons: !!r.can_host_lessons,
  canUploadContent: !!r.can_upload_content,
  status: r.status === 'disabled' ? 'disabled' : 'active',
});

// Spec 4.1: the Super Admin adds, edits and deletes teachers. Super Admin accounts are
// left alone here; they come from the installer and, in M4, the signed field-person list.
export class StaffAdminService {
  constructor(
    private readonly now: Clock,
    private readonly staff: StaffRepository,
    private readonly sessions: SessionRepository,
    private readonly audit: AuditLog,
  ) {}

  list(): StaffMember[] {
    return this.staff.list().map(toStaffMember);
  }

  async addTeacher(actor: StaffPrincipal, t: NewTeacher): Promise<StaffMember> {
    const passwordHash = await hashSecret(t.password);
    const row = unique(
      () => this.staff.insertTeacher({ username: t.username, displayName: t.displayName, passwordHash, now: this.now() }),
      `Username "${t.username}" is already taken.`,
    );
    this.audit.record(by(actor), 'staff.add', row.id);
    return toStaffMember(row);
  }

  updateTeacher(actor: StaffPrincipal, id: string, u: UpdateTeacher): StaffMember {
    this.teacher(id);
    this.staff.update(id, u, this.now());
    this.audit.record(by(actor), 'staff.update', id, u);
    return toStaffMember(this.staff.findById(id)!);
  }

  async setPassword(actor: StaffPrincipal, id: string, password: string) {
    this.teacher(id);
    this.staff.update(id, { passwordHash: await hashSecret(password) }, this.now());
    this.sessions.deleteForUser('staff', id);
    this.audit.record(by(actor), 'staff.password', id);
  }

  remove(actor: StaffPrincipal, id: string) {
    this.teacher(id);
    this.staff.update(id, { status: 'deleted' }, this.now());
    this.sessions.deleteForUser('staff', id);
    this.audit.record(by(actor), 'staff.delete', id);
  }

  private teacher(id: string): StaffRow {
    const row = this.staff.findById(id);
    if (!row || row.status === 'deleted') throw notFound('Teacher');
    if (row.role === 'super_admin') throw forbidden('Super Admin accounts are managed by the field team.');
    return row;
  }
}

const by = (actor: StaffPrincipal) => ({ kind: 'staff' as const, id: actor.userId });
