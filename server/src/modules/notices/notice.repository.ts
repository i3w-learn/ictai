import type { Notice, NoticeInput } from '@ict/contracts';
import type { Db } from '../../infra/db/index.js';

type Row = Omit<Notice, 'pinned' | 'expired'> & { pinned: number };

const SELECT = `
  SELECT n.id, n.title, n.body, n.class_id AS classId, c.name AS className, n.section_id AS sectionId, s.name AS sectionName,
         n.pinned, n.expires_at AS expiresAt, u.display_name AS byName, n.created_at AS createdAt
  FROM notices n
  LEFT JOIN classes c ON c.id = n.class_id
  LEFT JOIN sections s ON s.id = n.section_id
  JOIN users u ON u.id = n.created_by`;
// Pinned on top, then the newest first.
const ORDER = 'ORDER BY n.pinned DESC, n.created_at DESC';

const toNotice = (r: Row, now: number): Notice => ({ ...r, pinned: !!r.pinned, expired: r.expiresAt !== null && r.expiresAt <= now });

export class NoticeRepository {
  constructor(private readonly db: Db) {}

  insert(id: string, n: NoticeInput, by: string, now: number) {
    this.db
      .prepare('INSERT INTO notices (id, title, body, class_id, section_id, pinned, expires_at, created_by, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(id, n.title, n.body, n.classId, n.sectionId, n.pinned ? 1 : 0, n.expiresAt, by, now, now);
  }

  update(id: string, n: NoticeInput, now: number) {
    this.db
      .prepare('UPDATE notices SET title = ?, body = ?, class_id = ?, section_id = ?, pinned = ?, expires_at = ?, updated_at = ? WHERE id = ?')
      .run(n.title, n.body, n.classId, n.sectionId, n.pinned ? 1 : 0, n.expiresAt, now, id);
  }

  remove(id: string) {
    this.db.prepare('DELETE FROM notices WHERE id = ?').run(id);
  }

  get(id: string, now: number): Notice | undefined {
    const r = this.db.prepare(`${SELECT} WHERE n.id = ?`).get(id) as Row | undefined;
    return r && toNotice(r, now);
  }

  all(now: number): Notice[] {
    return (this.db.prepare(`${SELECT} ${ORDER}`).all() as Row[]).map((r) => toNotice(r, now));
  }

  // What one student should see: school-wide notices, their class's, and their own section's. Never an expired one.
  forStudent(classId: string, sectionId: string | null, now: number): Notice[] {
    const rows = this.db
      .prepare(
        `${SELECT}
         WHERE (n.expires_at IS NULL OR n.expires_at > ?)
           AND (n.class_id IS NULL OR (n.class_id = ? AND (n.section_id IS NULL OR n.section_id = ?)))
         ${ORDER}`,
      )
      .all(now, classId, sectionId) as Row[];
    return rows.map((r) => toNotice(r, now));
  }
}
