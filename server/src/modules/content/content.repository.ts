import type { ContentItem, ContentKind } from '@ict/contracts';
import type { Db } from '../../infra/db/index.js';

type Row = Omit<ContentItem, 'needsInternet'> & { needsInternet: number };

const SELECT = `
  SELECT i.id, i.title, i.kind, i.class_id AS classId, c.name AS className, i.subject, i.chapter,
         i.file_hash AS fileHash, i.file_name AS fileName, f.size, f.mime, i.url, i.needs_internet AS needsInternet,
         u.display_name AS byName, i.created_at AS createdAt
  FROM content_items i
  JOIN classes c ON c.id = i.class_id
  LEFT JOIN files f ON f.sha256 = i.file_hash
  JOIN users u ON u.id = i.created_by`;
// Filed the way a teacher thinks of it: subject, then chapter, then title.
const ORDER = `ORDER BY c.name, i.subject IS NULL, i.subject COLLATE NOCASE, i.chapter IS NULL, i.chapter COLLATE NOCASE, i.title COLLATE NOCASE`;
const toItem = (r: Row): ContentItem => ({ ...r, needsInternet: !!r.needsInternet });

export class ContentRepository {
  constructor(private readonly db: Db) {}

  addFile(sha256: string, size: number, mime: string, now: number) {
    this.db.prepare('INSERT OR IGNORE INTO files (sha256, size, mime, created_at) VALUES (?, ?, ?, ?)').run(sha256, size, mime, now);
  }

  insert(i: { id: string; title: string; kind: ContentKind; classId: string; subject: string | null; chapter: string | null; fileHash: string | null; fileName: string | null; url: string | null; by: string; now: number }) {
    this.db
      .prepare('INSERT INTO content_items (id, title, kind, class_id, subject, chapter, file_hash, file_name, url, needs_internet, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(i.id, i.title, i.kind, i.classId, i.subject, i.chapter, i.fileHash, i.fileName, i.url, i.url ? 1 : 0, i.by, i.now);
  }

  get(id: string): ContentItem | undefined {
    const r = this.db.prepare(`${SELECT} WHERE i.id = ? AND i.deleted_at IS NULL`).get(id) as Row | undefined;
    return r && toItem(r);
  }

  all(classId?: string): ContentItem[] {
    const rows = (classId
      ? this.db.prepare(`${SELECT} WHERE i.deleted_at IS NULL AND i.class_id = ? ${ORDER}`).all(classId)
      : this.db.prepare(`${SELECT} WHERE i.deleted_at IS NULL ${ORDER}`).all()) as Row[];
    return rows.map(toItem);
  }

  remove(id: string, now: number) {
    this.db.prepare('UPDATE content_items SET deleted_at = ? WHERE id = ?').run(now, id);
  }

  // Is any library item still using this file? When none is, the file itself can go.
  fileInUse(hash: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM content_items WHERE file_hash = ? AND deleted_at IS NULL').get(hash);
  }

  // Removed items still point at the file they had; that pointer is cleared first, then the file's row goes.
  forgetFile(hash: string) {
    this.db.transaction(() => {
      this.db.prepare('UPDATE content_items SET file_hash = NULL WHERE file_hash = ? AND deleted_at IS NOT NULL').run(hash);
      this.db.prepare('DELETE FROM files WHERE sha256 = ?').run(hash);
    })();
  }

  // A student may read a file only when it is in their own class's library.
  fileForClass(hash: string, classId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM content_items WHERE file_hash = ? AND class_id = ? AND deleted_at IS NULL').get(hash, classId);
  }

  fileMime(hash: string): string | undefined {
    return this.db.prepare('SELECT mime FROM files WHERE sha256 = ?').pluck().get(hash) as string | undefined;
  }

  classesOfFile(hash: string): string[] {
    return this.db.prepare('SELECT DISTINCT class_id FROM content_items WHERE file_hash = ? AND deleted_at IS NULL').pluck().all(hash) as string[];
  }
}
