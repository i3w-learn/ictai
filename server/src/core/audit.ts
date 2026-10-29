import type { AuditEntry } from '@ict/contracts';
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

  // Newest first. Names are looked up now, so a renamed teacher shows their current name.
  list(before?: number, limit = 100): AuditEntry[] {
    const rows = this.db
      .prepare(
        `SELECT a.id, a.at, a.actor_kind AS actorKind, a.action, a.target, a.detail,
           CASE a.actor_kind WHEN 'staff' THEN au.display_name WHEN 'student' THEN ast.name WHEN 'device' THEN ad.name END AS actorName,
           COALESCE(tu.display_name, tst.name, td.name, tc.name) AS targetName
         FROM audit_log a
         LEFT JOIN users au ON a.actor_kind = 'staff' AND au.id = a.actor_id
         LEFT JOIN students ast ON a.actor_kind = 'student' AND ast.id = a.actor_id
         LEFT JOIN devices ad ON a.actor_kind = 'device' AND ad.id = a.actor_id
         LEFT JOIN users tu ON tu.id = a.target
         LEFT JOIN students tst ON tst.id = a.target
         LEFT JOIN devices td ON td.id = a.target
         LEFT JOIN classes tc ON tc.id = a.target
         WHERE a.id < ?
         ORDER BY a.id DESC
         LIMIT ?`,
      )
      .all(before ?? Number.MAX_SAFE_INTEGER, limit) as (Omit<AuditEntry, 'detail'> & { detail: string | null })[];
    return rows.map((r) => ({ ...r, detail: r.detail == null ? null : JSON.parse(r.detail) }));
  }
}
