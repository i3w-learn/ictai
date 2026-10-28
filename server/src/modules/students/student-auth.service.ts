import type { DevicePrincipal, RosterEntry, SchoolClass, SessionResult } from '@ict/contracts';
import type { AuditLog } from '../../core/audit.js';
import { HOUR, MINUTE, type Clock } from '../../core/clock.js';
import { AppError, lockedOut } from '../../core/errors.js';
import type { FailureLimiter } from '../auth/limiter.js';
import { checkSecret, hashSecret, hashToken } from '../auth/secrets.js';
import type { SessionService } from '../auth/session.service.js';
import type { ClassRepository } from './class.repository.js';
import type { StudentAuthRow, StudentRepository } from './student.repository.js';

// Spec 3: student sessions end after 10 min idle (and at sign-out or lesson end).
export const STUDENT_SESSION = { idleMs: 10 * MINUTE, maxMs: 8 * HOUR };

const wrongPin = () => new AppError(401, 'INVALID_CREDENTIALS', 'That PIN is not right.');

// Student sign-in on an enrolled lab PC: class + name + PIN, QR card, or first-time code.
export class StudentAuthService {
  constructor(
    private readonly now: Clock,
    private readonly classes: ClassRepository,
    private readonly students: StudentRepository,
    private readonly sessions: SessionService,
    private readonly limiter: FailureLimiter,
    private readonly audit: AuditLog,
  ) {}

  listClasses(): SchoolClass[] {
    return this.classes.listClasses();
  }

  roster(classId: string): RosterEntry[] {
    return this.students.roster(classId);
  }

  async withPin(device: DevicePrincipal, studentId: string, pin: string): Promise<SessionResult> {
    const key = `pin:${device.deviceId}:${studentId}`;
    const wait = this.limiter.blockedFor(key);
    if (wait > 0) throw lockedOut(wait);

    const st = this.students.findActive(studentId);
    if (!st?.pin_hash || !(await checkSecret(pin, st.pin_hash))) {
      this.limiter.fail(key);
      throw wrongPin();
    }
    this.limiter.succeed(key);
    return this.start(device, st, 'pin');
  }

  withQr(device: DevicePrincipal, qrToken: string): SessionResult {
    const st = this.students.findByQrHash(hashToken(qrToken));
    if (!st) throw new AppError(401, 'INVALID_CREDENTIALS', 'This card is not recognised.');
    return this.start(device, st, 'qr');
  }

  async firstSignIn(device: DevicePrincipal, code: string, pin: string): Promise<SessionResult> {
    const key = `enrol-code:${device.deviceId}`;
    const wait = this.limiter.blockedFor(key);
    if (wait > 0) throw lockedOut(wait);

    const now = this.now();
    const st = this.students.findByEnrolCodeHash(hashToken(code), now);
    if (!st) {
      this.limiter.fail(key);
      throw new AppError(401, 'INVALID_CREDENTIALS', 'That code is not right or has expired.');
    }
    this.limiter.succeed(key);
    this.students.setPin(st.id, await hashSecret(pin), now);
    this.students.setEnrolCode(st.id, null, null, now); // one-time
    return this.start(device, st, 'enrolment-code');
  }

  private start(device: DevicePrincipal, st: StudentAuthRow, method: string): SessionResult {
    this.audit.record({ kind: 'student', id: st.id }, 'signin', device.deviceId, { method });
    return this.sessions.start('student', st.id, device.deviceId, STUDENT_SESSION);
  }
}
