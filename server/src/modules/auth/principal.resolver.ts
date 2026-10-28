import type { Principal } from '@ict/contracts';
import { DAY, type Clock } from '../../core/clock.js';
import type { DeviceRepository } from '../devices/device.repository.js';
import type { StudentRepository } from '../students/student.repository.js';
import { STUDENT_PERMISSIONS, staffPermissions } from './permissions.js';
import { hashToken } from './secrets.js';
import type { SessionRepository, SessionRow } from './session.repository.js';
import type { StaffRepository } from './staff.repository.js';

export const DEVICE_TOKEN_MS = 90 * DAY;
const DEVICE_RENEW_BELOW_MS = 45 * DAY;

// Turns a bearer token into who is calling. Looked up fresh on every request,
// so a disabled user or a changed permission takes effect at once (spec 3).
export class PrincipalResolver {
  constructor(
    private readonly now: Clock,
    private readonly sessions: SessionRepository,
    private readonly staff: StaffRepository,
    private readonly students: StudentRepository,
    private readonly devices: DeviceRepository,
  ) {}

  resolve(token: string | null): Principal | null {
    if (!token) return null;
    const hash = hashToken(token);
    const session = this.sessions.findByTokenHash(hash);
    return session ? this.fromSession(session) : this.fromDevice(hash);
  }

  private fromSession(s: SessionRow): Principal | null {
    const now = this.now();
    if (now > s.expires_at || now - s.last_used_at > s.idle_ms) return this.end(s);

    if (s.kind === 'staff') {
      const u = this.staff.findById(s.user_id);
      if (!u || u.status !== 'active') return this.end(s);
      this.sessions.touch(s.id, now);
      return {
        kind: 'staff', userId: u.id, role: u.role, username: u.username,
        displayName: u.display_name, permissions: staffPermissions(u),
      };
    }

    if (s.kind === 'student') {
      const st = this.students.findActive(s.user_id);
      // A student session is bound to the lab PC it started on.
      if (!st || !s.device_id || !this.devices.isActive(s.device_id)) return this.end(s);
      this.sessions.touch(s.id, now);
      return {
        kind: 'student', studentId: st.id, name: st.name, classId: st.class_id,
        sectionId: st.section_id, deviceId: s.device_id, permissions: STUDENT_PERMISSIONS,
      };
    }

    return this.end(s); // guardian sessions arrive in P2
  }

  private fromDevice(hash: string): Principal | null {
    const d = this.devices.findActiveByTokenHash(hash);
    const now = this.now();
    if (!d || now > d.token_expires_at) return null;
    // Spec 3: device tokens last 90 days and renew while in use.
    const expires = d.token_expires_at - now < DEVICE_RENEW_BELOW_MS ? now + DEVICE_TOKEN_MS : d.token_expires_at;
    this.devices.markSeen(d.id, now, expires);
    return { kind: 'device', deviceId: d.id, deviceKind: d.kind, name: d.name };
  }

  private end(s: SessionRow): null {
    this.sessions.delete(s.id);
    return null;
  }
}
