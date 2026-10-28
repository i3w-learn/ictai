import Database from 'better-sqlite3';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { migrations, type Migration } from './migrations.js';

export type Db = Database.Database;

export function openDb(file: string, list: Migration[] = migrations): Db {
  const inMemory = file === ':memory:';
  if (!inMemory) mkdirSync(dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  migrate(db, list, inMemory ? null : file);
  return db;
}

// Applies pending migrations in order, each in its own transaction.
// Takes a copy of the database file before the first pending one (spec 11).
export function migrate(db: Db, list: Migration[], file: string | null): number[] {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)`);
  const done = new Set(
    db.prepare('SELECT version FROM schema_migrations').pluck().all() as number[],
  );
  const pending = [...list].sort((a, b) => a.version - b.version).filter((m) => !done.has(m.version));
  if (pending.length === 0) return [];

  if (file && done.size > 0 && existsSync(file)) {
    db.pragma('wal_checkpoint(TRUNCATE)');
    const backups = join(dirname(file), 'backups');
    mkdirSync(backups, { recursive: true });
    copyFileSync(file, join(backups, `pre-migration-${pending[0]!.version}-${Date.now()}.db`));
  }

  for (const m of pending) {
    db.transaction(() => {
      db.exec(m.sql);
      db.prepare('INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)')
        .run(m.version, m.name, Date.now());
    })();
  }
  return pending.map((m) => m.version);
}
