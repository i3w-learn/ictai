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

  // A request: it counts as activity, so the session's idle timer and a device's last-seen move.
  resolve(token: string | null): Principal | null {
    if (!token) return null;
    return this.lookup(hashToken(token), true);
  }

  // A look that changes nothing. The live socket asks this on every push: watching a room is
  // not using the app, so it must neither write nor keep an idle session alive.
  peek(tokenHash: string): Principal | null {
    return this.lookup(tokenHash, false);
  }

  private lookup(hash: string, touch: boolean): Principal | null {
    const session = this.sessions.findByTokenHash(hash);
    return session ? this.fromSession(session, touch) : this.fromDevice(hash, touch);
  }

  private fromSession(s: SessionRow, touch: boolean): Principal | null {
    const now = this.now();
    if (now > s.expires_at || now - s.last_used_at > s.idle_ms) return this.end(s, touch);

    if (s.kind === 'staff') {
      const u = this.staff.findById(s.user_id);
      if (!u || u.status !== 'active') return this.end(s, touch);
      if (touch) this.sessions.touch(s.id, now);
      // Read fresh each time, so a change the Super Admin makes applies on the next request.
      const limited = u.role === 'teacher';
      const classIds = limited ? this.staff.classIds(u.id) : [];
      const subjects = limited ? this.staff.subjects(u.id) : [];
      return {
        kind: 'staff', userId: u.id, role: u.role, username: u.username,
        displayName: u.display_name, permissions: staffPermissions(u),
        classIds: classIds.length ? classIds : null,
        subjects: subjects.length ? subjects : null,
      };
    }

    if (s.kind === 'student') {
      const st = this.students.findActive(s.user_id);
      // A student session is bound to the lab PC it started on.
      if (!st || !s.device_id || !this.devices.isActive(s.device_id)) return this.end(s, touch);
      if (touch) this.sessions.touch(s.id, now);
      return {
        kind: 'student', studentId: st.id, name: st.name, classId: st.class_id,
        sectionId: st.section_id, deviceId: s.device_id, permissions: STUDENT_PERMISSIONS,
      };
    }

    return this.end(s, touch); // guardian sessions arrive in P2
  }

  private fromDevice(hash: string, touch: boolean): Principal | null {
    const d = this.devices.findActiveByTokenHash(hash);
    const now = this.now();
    if (!d || now > d.token_expires_at) return null;
    if (touch) {
      // Spec 3: device tokens last 90 days and renew while in use.
      const expires = d.token_expires_at - now < DEVICE_RENEW_BELOW_MS ? now + DEVICE_TOKEN_MS : d.token_expires_at;
      this.devices.markSeen(d.id, now, expires);
    }
    return { kind: 'device', deviceId: d.id, deviceKind: d.kind, name: d.name };
  }

  // A dead session is removed by the request that finds it; a peek leaves that to the next request.
  private end(s: SessionRow, remove: boolean): null {
    if (remove) this.sessions.delete(s.id);
    return null;
  }
}
