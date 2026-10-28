// Numbered migrations (spec 11: no "add missing columns at startup").
// Append new entries; never edit one that has shipped.
export interface Migration {
  version: number;
  name: string;
  sql: string;
}

export const migrations: Migration[] = [
  {
    version: 1,
    name: 'init',
    sql: `
      CREATE TABLE meta (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE school (
        id          INTEGER PRIMARY KEY CHECK (id = 1),
        server_id   TEXT NOT NULL,
        school_id   TEXT,
        name        TEXT NOT NULL,
        activated   INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL
      );

      CREATE TABLE users (
        id                 TEXT PRIMARY KEY,
        role               TEXT NOT NULL CHECK (role IN ('super_admin','teacher')),
        username           TEXT NOT NULL UNIQUE COLLATE NOCASE,
        display_name       TEXT NOT NULL,
        password_hash      TEXT NOT NULL,
        can_host_lessons   INTEGER NOT NULL DEFAULT 1,
        can_upload_content INTEGER NOT NULL DEFAULT 1,
        status             TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','disabled','deleted')),
        created_at         INTEGER NOT NULL,
        updated_at         INTEGER NOT NULL
      );

      CREATE TABLE sessions (
        id           TEXT PRIMARY KEY,
        token_hash   TEXT NOT NULL UNIQUE,
        kind         TEXT NOT NULL CHECK (kind IN ('staff','student','guardian')),
        user_id      TEXT NOT NULL,
        device_id    TEXT,
        created_at   INTEGER NOT NULL,
        last_used_at INTEGER NOT NULL,
        idle_ms      INTEGER NOT NULL,
        expires_at   INTEGER NOT NULL
      );
      CREATE INDEX sessions_user ON sessions(user_id);

      CREATE TABLE devices (
        id               TEXT PRIMARY KEY,
        kind             TEXT NOT NULL CHECK (kind IN ('lab_pc','board')),
        name             TEXT NOT NULL,
        token_hash       TEXT UNIQUE,
        token_expires_at INTEGER,
        class_id         TEXT,
        section_id       TEXT,
        app_version      TEXT,
        status           TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','retired')),
        last_seen        INTEGER,
        dirty            INTEGER NOT NULL DEFAULT 1,
        created_at       INTEGER NOT NULL
      );

      CREATE TABLE enrol_windows (
        id         TEXT PRIMARY KEY,
        code       TEXT NOT NULL,
        opened_by  TEXT NOT NULL REFERENCES users(id),
        opened_at  INTEGER NOT NULL,
        closes_at  INTEGER NOT NULL,
        closed_at  INTEGER
      );

      CREATE TABLE audit_log (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        at         INTEGER NOT NULL,
        actor_kind TEXT NOT NULL,
        actor_id   TEXT,
        action     TEXT NOT NULL,
        target     TEXT,
        detail     TEXT
      );
    `,
  },
  {
    version: 2,
    name: 'school_structure_and_students',
    sql: `
      CREATE TABLE classes (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL UNIQUE COLLATE NOCASE,
        created_at INTEGER NOT NULL
      );

      CREATE TABLE sections (
        id         TEXT PRIMARY KEY,
        class_id   TEXT NOT NULL REFERENCES classes(id),
        name       TEXT NOT NULL COLLATE NOCASE,
        created_at INTEGER NOT NULL,
        UNIQUE (class_id, name)
      );

      CREATE TABLE students (
        id                   TEXT PRIMARY KEY,
        name                 TEXT NOT NULL,
        class_id             TEXT NOT NULL REFERENCES classes(id),
        section_id           TEXT REFERENCES sections(id),
        roll_no              TEXT,
        pin_hash             TEXT,
        qr_token_hash        TEXT NOT NULL UNIQUE,
        enrol_code_hash      TEXT UNIQUE,
        enrol_code_expires_at INTEGER,
        status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','deleted')),
        created_at           INTEGER NOT NULL,
        updated_at           INTEGER NOT NULL
      );
      CREATE INDEX students_class ON students(class_id, status);
    `,
  },
];
