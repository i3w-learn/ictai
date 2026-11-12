import { sameRoll, type DevicePrincipal, type RosterEntry, type SchoolClass, type Section, type SessionResult } from '@ict/contracts';
import type { AuditLog } from '../../core/audit.js';
import { HOUR, MINUTE, type Clock } from '../../core/clock.js';
import { AppError, lockedOut, notFound } from '../../core/errors.js';
import type { FailureLimiter } from '../auth/limiter.js';
import { checkSecret, hashSecret, hashToken } from '../auth/secrets.js';
import type { SessionRepository } from '../auth/session.repository.js';
import type { SessionService } from '../auth/session.service.js';
import type { DeviceRepository } from '../devices/device.repository.js';
import type { ClassRepository } from './class.repository.js';
import type { StudentAuthRow, StudentRepository } from './student.repository.js';

// Spec 3: student sessions end after 10 min idle (and at sign-out or lesson end).
export const STUDENT_SESSION = { idleMs: 10 * MINUTE, maxMs: 8 * HOUR };

const wrongPin = () => new AppError(401, 'INVALID_CREDENTIALS', 'That PIN is not right.');

// Student sign-in on an enrolled lab PC: class + roll number, class + name + PIN, QR card, or first-time code.
export class StudentAuthService {
  constructor(
    private readonly now: Clock,
    private readonly classes: ClassRepository,
    private readonly students: StudentRepository,
    private readonly sessions: SessionService,
    private readonly limiter: FailureLimiter,
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
  withRoll(device: DevicePrincipal, who: { classId: string; sectionId: string | null; rollNo: string }): SessionResult {
    if (!this.classes.classExists(who.classId)) throw notFound('Class');
    const sections = this.classes.listSections(who.classId);
    if (who.sectionId ? !sections.some((s) => s.id === who.sectionId) : sections.length > 0) {
      throw new AppError(400, 'BAD_REQUEST', 'Choose your section.');
    }

    const same = this.students.roster(who.classId).filter((s) => sameRoll(s, who.sectionId, who.rollNo));
    if (same.length > 1) throw new AppError(409, 'ROLL_NOT_UNIQUE', `More than one student has roll number ${who.rollNo}. Ask your teacher.`);

    // Only a student the teacher has added gets in. A roll number nobody has is turned away, not added.
    const known = same[0];
    if (!known) throw new AppError(404, 'ROLL_UNKNOWN', `Roll number ${who.rollNo} is not in this class. Ask your teacher to add you.`);

    const st = this.students.findActive(known.id)!;
    // A PIN the teacher set still counts: the roll number alone never gets past it.
    if (st.pin_hash) throw new AppError(401, 'PIN_REQUIRED', `${known.name} signs in with a PIN.`);

    // One student, one lab PC at a time: without a PIN this is what stops a friend signing in as you.
    const elsewhere = this.sessionRows.liveStudentDevice(st.id, device.deviceId, this.now());
    if (elsewhere) {
      throw new AppError(409, 'ALREADY_SIGNED_IN', `${st.name} is already signed in on ${this.devices.name(elsewhere) ?? 'another PC'}. Sign out there first.`);
    }
    return this.start(device, st, 'roll');
  }

  async withPin(device: DevicePrincipal, studentId: string, pin: string): Promise<SessionResult> {
    const key = `pin:${device.deviceId}:${studentId}`;
    const wait = this.limiter.blockedFor(key);
    if (wait > 0) throw lockedOut(wait);

    const st = this.students.findActive(studentId);
    if (!st?.pin_hash || !(await checkSecret(pin, st.pin_hash))) {
      this.failed(device, key, 'pin', st?.id ?? null);
      throw wrongPin();
    }
    this.limiter.succeed(key);
    return this.start(device, st, 'pin');
  }

  // Same lockout as wrong PINs, counted per lab PC: five unknown cards and it waits five minutes.
  withQr(device: DevicePrincipal, qrToken: string): SessionResult {
    const key = `qr:${device.deviceId}`;
    const wait = this.limiter.blockedFor(key);
    if (wait > 0) throw lockedOut(wait);

    const st = this.students.findByQrHash(hashToken(qrToken));
    if (!st) {
      this.failed(device, key, 'qr');
      throw new AppError(401, 'INVALID_CREDENTIALS', 'This card is not recognised.');
    }
    this.limiter.succeed(key);
    return this.start(device, st, 'qr');
  }

  async firstSignIn(device: DevicePrincipal, code: string, pin: string): Promise<SessionResult> {
    const key = `enrol-code:${device.deviceId}`;
    const wait = this.limiter.blockedFor(key);
    if (wait > 0) throw lockedOut(wait);

    const now = this.now();
    const st = this.students.findByEnrolCodeHash(hashToken(code), now);
    if (!st) {
      this.failed(device, key, 'enrolment-code');
      throw new AppError(401, 'INVALID_CREDENTIALS', 'That code is not right or has expired.');
    }
    this.limiter.succeed(key);
    this.students.setPin(st.id, await hashSecret(pin), now);
    this.students.setEnrolCode(st.id, null, null, now); // one-time
    return this.start(device, st, 'enrolment-code');
  }

  // Spec 4.5: wrong tries are logged against the lab PC they came from, never with what was typed.
  private failed(device: DevicePrincipal, key: string, method: string, studentId: string | null = null) {
    this.limiter.fail(key);
    this.audit.record({ kind: 'device', id: device.deviceId }, 'student.signin.failed', studentId, { method });
  }

  private start(device: DevicePrincipal, st: StudentAuthRow, method: string): SessionResult {
    this.audit.record({ kind: 'student', id: st.id }, 'signin', device.deviceId, { method });
    return this.sessions.start('student', st.id, device.deviceId, STUDENT_SESSION);
  }
}
