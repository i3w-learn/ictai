import { sameRoll, type DevicePrincipal, type RosterEntry, type SchoolClass, type Section, type SessionResult } from '@ict/contracts';
import type { AuditLog } from '../../core/audit.js';
import { HOUR, MINUTE, type Clock } from '../../core/clock.js';
import { AppError, notFound } from '../../core/errors.js';
import type { SessionRepository } from '../auth/session.repository.js';
import type { SessionService } from '../auth/session.service.js';
import type { DeviceRepository } from '../devices/device.repository.js';
import type { ClassRepository } from './class.repository.js';
import type { StudentAuthRow, StudentRepository } from './student.repository.js';

// Spec 3: student sessions end after 10 min idle (and at sign-out or lesson end).
export const STUDENT_SESSION = { idleMs: 10 * MINUTE, maxMs: 8 * HOUR };

// Student sign-in on an enrolled lab PC: class + roll number (and the name, when two share a number).
// There is no PIN.
export class StudentAuthService {
  constructor(
    private readonly now: Clock,
    private readonly classes: ClassRepository,
    private readonly students: StudentRepository,
    private readonly sessions: SessionService,
    private readonly audit: AuditLog,
    private readonly sessionRows: SessionRepository,
    private readonly devices: DeviceRepository,
  ) {}

  listClasses(): SchoolClass[] {
    return this.classes.listClasses();
  }

  roster(classId: string): RosterEntry[] {
    return this.students.roster(classId);
  }

  sections(classId: string): Section[] {
    return this.classes.listSections(classId);
  }

  // Easy sign-in for young students: class, section and roll number, no PIN. A roll number the
  // server has not seen is added as a new student, with the name the student typed.
  // Nothing here waits, so two students sending the same roll number at once are handled one
  // after the other: the first is added and the second is told whose number it is.
  withRoll(device: DevicePrincipal, who: { classId: string; sectionId: string | null; rollNo: string; studentId?: string }): SessionResult {
    if (!this.classes.classExists(who.classId)) throw notFound('Class');
    const sections = this.classes.listSections(who.classId);
    if (who.sectionId ? !sections.some((s) => s.id === who.sectionId) : sections.length > 0) {
      throw new AppError(400, 'BAD_REQUEST', 'Choose your section.');
    }

    const same = this.students.roster(who.classId).filter((s) => sameRoll(s, who.sectionId, who.rollNo));
    // Only a student the teacher has added gets in. A roll number nobody has is turned away, not added.
    if (same.length === 0) throw new AppError(404, 'ROLL_UNKNOWN', `Roll number ${who.rollNo} is not in this class. Ask your teacher to add you.`);
    // Class, roll number and full name together are one student (the teacher cannot add the same three
    // twice). So when two students share a roll number, the name the student picked settles it. The
    // name picked must be one of those with this roll number: it is never a way in as someone else.
    const known = who.studentId ? same.find((s) => s.id === who.studentId) : same.length === 1 ? same[0] : undefined;
    if (!known) throw new AppError(409, 'ROLL_NOT_UNIQUE', `More than one student has roll number ${who.rollNo}. Pick your name.`);

    const st = this.students.findActive(known.id)!;
    // One student, one lab PC at a time: this is what stops a friend signing in as you.
    const elsewhere = this.sessionRows.liveStudentDevice(st.id, device.deviceId, this.now());
    if (elsewhere) {
      throw new AppError(409, 'ALREADY_SIGNED_IN', `${st.name} is already signed in on ${this.devices.name(elsewhere) ?? 'another PC'}. Sign out there first.`);
    }
    return this.start(device, st, 'roll');
  }

  private start(device: DevicePrincipal, st: StudentAuthRow, method: string): SessionResult {
    this.audit.record({ kind: 'student', id: st.id }, 'signin', device.deviceId, { method });
    return this.sessions.start('student', st.id, device.deviceId, STUDENT_SESSION);
  }
}
