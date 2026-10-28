import type { Db } from '../infra/db/index.js';
import type { Clock } from './clock.js';

export interface Actor {
  kind: 'staff' | 'student' | 'device' | 'system';
  id: string | null;
}

// Spec 4.5: who did what and when.
export class AuditLog {
  constructor(
    private readonly db: Db,
    private readonly now: Clock,
  ) {}

  record(actor: Actor, action: string, target: string | null = null, detail: unknown = null) {
    this.db
      .prepare('INSERT INTO audit_log (at, actor_kind, actor_id, action, target, detail) VALUES (?, ?, ?, ?, ?, ?)')
      .run(this.now(), actor.kind, actor.id, action, target, detail == null ? null : JSON.stringify(detail));
  }
}
