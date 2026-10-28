import { randomUUID } from 'node:crypto';
import type { SchoolClass, Section } from '@ict/contracts';
import type { Db } from '../../infra/db/index.js';

export class ClassRepository {
  constructor(private readonly db: Db) {}

  listClasses(): SchoolClass[] {
    return this.db.prepare('SELECT id, name FROM classes ORDER BY name').all() as SchoolClass[];
  }

  insertClass(name: string, now: number): SchoolClass {
    const id = randomUUID();
    this.db.prepare('INSERT INTO classes (id, name, created_at) VALUES (?, ?, ?)').run(id, name, now);
    return { id, name };
  }

  insertSection(classId: string, name: string, now: number): Section {
    const id = randomUUID();
    this.db.prepare('INSERT INTO sections (id, class_id, name, created_at) VALUES (?, ?, ?, ?)').run(id, classId, name, now);
    return { id, classId, name };
  }

  classExists(id: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM classes WHERE id = ?').get(id);
  }

  sectionInClass(sectionId: string, classId: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM sections WHERE id = ? AND class_id = ?').get(sectionId, classId);
  }
}
