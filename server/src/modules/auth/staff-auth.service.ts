import type { SessionResult, StaffLogin, StaffRole } from '@ict/contracts';
import type { AuditLog } from '../../core/audit.js';
import { HOUR, MINUTE, type Clock } from '../../core/clock.js';
import { AppError, lockedOut } from '../../core/errors.js';
import type { FailureLimiter } from './limiter.js';
import { checkSecret, hashSecret, hashSecretSync } from './secrets.js';
import type { SessionService } from './session.service.js';
import type { StaffRepository } from './staff.repository.js';

// Spec 3: staff sessions end after 15 min idle; the whole session is capped at 12 h.
export const STAFF_SESSION = { idleMs: 15 * MINUTE, maxMs: 12 * HOUR };

// Checked when the username is unknown, so both paths take the same time.
const DUMMY_HASH = hashSecretSync('not-a-real-password');

export class StaffAuthService {
  constructor(
    private readonly now: Clock,
    private readonly staff: StaffRepository,
    private readonly sessions: SessionService,
    private readonly limiter: FailureLimiter,
    private readonly audit: AuditLog,
  ) {}

  async signIn(login: StaffLogin, clientIp: string): Promise<SessionResult> {
    const key = `staff:${clientIp}:${login.username.toLowerCase()}`;
    const wait = this.limiter.blockedFor(key);
    if (wait > 0) throw lockedOut(wait);

    const user = this.staff.findByUsername(login.username);
    const ok = await checkSecret(login.password, user?.password_hash ?? DUMMY_HASH);
    if (!user || !ok || user.status !== 'active') {
      this.limiter.fail(key);
      this.audit.record({ kind: 'staff', id: user?.id ?? null }, 'signin.failed', login.username);
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Wrong username or password.');
    }

    this.limiter.succeed(key);
    this.audit.record({ kind: 'staff', id: user.id }, 'signin');
    return this.sessions.start('staff', user.id, null, STAFF_SESSION);
  }

  // Until the signed field-person list arrives (M4), accounts are seeded directly.
  async upsertAccount(u: { username: string; password: string; role: StaffRole; displayName?: string }) {
    this.staff.upsert({
      username: u.username,
      passwordHash: await hashSecret(u.password),
      role: u.role,
      displayName: u.displayName ?? u.username,
      now: this.now(),
    });
  }
}
