import { randomUUID } from 'node:crypto';
import { CONNECTED_WITHIN_MS, type Device, type DeviceEnrol, type DeviceEnrolResult, type Joining, type StaffPrincipal } from '@ict/contracts';
import type { AuditLog } from '../../core/audit.js';
import type { Clock } from '../../core/clock.js';
import { AppError, lockedOut } from '../../core/errors.js';
import type { Db } from '../../infra/db/index.js';
import { seesClass, type Scope } from '../../core/scope.js';
import type { SessionRepository } from '../auth/session.repository.js';
import type { FailureLimiter } from '../auth/limiter.js';
import { DEVICE_TOKEN_MS } from '../auth/principal.resolver.js';
import { hashToken, newToken } from '../auth/secrets.js';
import type { SchoolIdentity } from '../system/school-identity.js';
import type { DeviceRepository } from './device.repository.js';

// Lab PCs and boards join by themselves: nothing is typed or pressed, on the PC or on the server PC.
// The cost of that ease: any machine on the lab network that runs the app can join. Staff see every
// device in their list, can remove one they do not know, and can lock the lab once all PCs are in.
const NAME = { lab_pc: 'Lab PC', board: 'Board' } as const;

export class DeviceEnrolmentService {
  constructor(
    private readonly now: Clock,
    private readonly devices: DeviceRepository,
    private readonly identity: SchoolIdentity,
    private readonly limiter: FailureLimiter,
    private readonly audit: AuditLog,
    private readonly sessions: SessionRepository,
    private readonly db: Db,
  ) {}

  joining(): Joining {
    return { open: this.devices.joiningOpen() };
  }

  setJoining(by: StaffPrincipal, open: boolean): Joining {
    this.devices.setJoining(open);
    this.audit.record({ kind: 'staff', id: by.userId }, open ? 'lab.unlock' : 'lab.lock', null, {});
    return { open };
  }

  enrol(req: DeviceEnrol, clientIp: string): DeviceEnrolResult {
    if (!this.devices.joiningOpen()) throw new AppError(409, 'ENROL_CLOSED', 'The lab is locked. Ask your teacher to unlock it on the server PC.');

    // Each join counts against the address it came from: after five from one address it waits five minutes,
    // so one machine cannot fill the lab with made-up PCs. A real PC joins once.
    const key = `enrol:${clientIp}`;
    const wait = this.limiter.blockedFor(key);
    if (wait > 0) throw lockedOut(wait);
    this.limiter.fail(key);

    const now = this.now();
    const id = randomUUID();
    const token = newToken();
    const expiresAt = now + DEVICE_TOKEN_MS;
    // Counting and adding in one step, so two PCs joining together do not get the same number.
    const name = this.db.transaction(() => {
      const name = `${NAME[req.kind]} ${this.devices.countOf(req.kind) + 1}`;
      this.devices.insert({ id, kind: req.kind, name, tokenHash: hashToken(token), expiresAt, appVersion: req.appVersion, now });
      return name;
    })();
    this.audit.record({ kind: 'device', id }, 'device.enrol', id, { kind: req.kind, name });

    const { serverId, certFp } = this.identity.current();
    return { deviceId: id, name, token, expiresAt, serverId, certFp };
  }

  // Staff throw out a PC they do not recognise (or one that left the lab). Its lab pass stops working at
  // once, and so does the sign-in of any student sitting at it.
  remove(by: StaffPrincipal, id: string) {
    if (!this.devices.retire(id)) throw new AppError(404, 'NOT_FOUND', 'That device is not in the lab.');
    this.audit.record({ kind: 'staff', id: by.userId }, 'device.remove', id, {});
  }

  // The lab at a glance: which PCs are switched on and reachable, and who is sitting at each.
  list(scope: Scope): Device[] {
    const now = this.now();
    // If a PC somehow holds two sign-ins, the later one is the student sitting there now.
    const students = new Map(this.sessions.liveStudents(now).map((s) => [s.deviceId, s]));
    return this.devices.list().map((d) => {
      const st = students.get(d.id);
      return {
        ...d,
        connected: d.status === 'active' && d.lastSeen !== null && now - d.lastSeen <= CONNECTED_WITHIN_MS,
        student: st ? { name: seesClass(scope, st.classId) ? st.name : null, className: st.className } : null,
      };
    });
  }
}
