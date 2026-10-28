import { randomUUID } from 'node:crypto';
import type { Db } from '../../infra/db/index.js';

export interface ServerIdentity {
  serverId: string;
  schoolId: string | null;
  name: string;
  activated: boolean;
  version: string;
  certFp: string | null;
}

// The server's permanent ID. Devices remember this ID, not the IP (spec 2.5).
export class SchoolIdentity {
  private certFp: string | null = null;

  constructor(
    private readonly db: Db,
    private readonly version: string,
  ) {}

  ensure(now: number, name = 'ICT Lab Server') {
    this.db
      .prepare('INSERT INTO school (id, server_id, name, created_at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO NOTHING')
      .run(randomUUID(), name, now);
  }

  setCertFingerprint(fp: string) {
    this.certFp = fp;
  }

  current(): ServerIdentity {
    const s = this.db.prepare('SELECT server_id, school_id, name, activated FROM school WHERE id = 1').get() as
      | { server_id: string; school_id: string | null; name: string; activated: number }
      | undefined;
    if (!s) throw new Error('School identity missing; call ensure() at startup.');
    return { serverId: s.server_id, schoolId: s.school_id, name: s.name, activated: !!s.activated, version: this.version, certFp: this.certFp };
  }
}
