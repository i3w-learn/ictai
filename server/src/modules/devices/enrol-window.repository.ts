import type { Db } from '../../infra/db/index.js';

export class EnrolWindowRepository {
  constructor(private readonly db: Db) {}

  // Only one window is open at a time; opening a new one closes the old.
  replaceOpen(w: { id: string; code: string; openedBy: string; now: number; closesAt: number }) {
    this.db.transaction(() => {
      this.closeAll(w.now);
      this.db
        .prepare('INSERT INTO enrol_windows (id, code, opened_by, opened_at, closes_at) VALUES (?, ?, ?, ?, ?)')
        .run(w.id, w.code, w.openedBy, w.now, w.closesAt);
    })();
  }

  closeAll(now: number) {
    this.db.prepare('UPDATE enrol_windows SET closed_at = ? WHERE closed_at IS NULL').run(now);
  }

  findOpen(now: number): { id: string; code: string } | undefined {
    return this.db
      .prepare('SELECT id, code FROM enrol_windows WHERE closed_at IS NULL AND closes_at > ?')
      .get(now) as { id: string; code: string } | undefined;
  }
}
