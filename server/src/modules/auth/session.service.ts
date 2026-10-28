import type { SessionResult } from '@ict/contracts';
import type { Clock } from '../../core/clock.js';
import type { PrincipalResolver } from './principal.resolver.js';
import { hashToken, newToken } from './secrets.js';
import type { SessionKind, SessionRepository } from './session.repository.js';

export interface SessionPolicy {
  idleMs: number;
  maxMs: number;
}

// Creates and ends sessions. Only the token's SHA-256 is stored (spec 3).
export class SessionService {
  constructor(
    private readonly now: Clock,
    private readonly sessions: SessionRepository,
    private readonly resolver: PrincipalResolver,
  ) {}

  start(kind: SessionKind, userId: string, deviceId: string | null, policy: SessionPolicy): SessionResult {
    const now = this.now();
    const token = newToken();
    const expiresAt = now + policy.maxMs;
    this.sessions.insert({ tokenHash: hashToken(token), kind, userId, deviceId, now, idleMs: policy.idleMs, expiresAt });
    const principal = this.resolver.resolve(token);
    if (!principal) throw new Error('A new session did not resolve.');
    return { token, expiresAt, principal };
  }

  end(token: string) {
    this.sessions.deleteByTokenHash(hashToken(token));
  }
}
