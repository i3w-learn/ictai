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
  {
    version: 3,
    name: 'quizzes_and_lab_mode',
    sql: `
      CREATE TABLE quizzes (
        id                   TEXT PRIMARY KEY,
        title                TEXT NOT NULL,
        class_id             TEXT NOT NULL REFERENCES classes(id),
        subject              TEXT,
        topic                TEXT,
        seconds_per_question INTEGER NOT NULL,
        questions_json       TEXT NOT NULL,
        created_by           TEXT NOT NULL REFERENCES users(id),
        status               TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','deleted')),
        created_at           INTEGER NOT NULL,
        updated_at           INTEGER NOT NULL
      );
      CREATE INDEX quizzes_class ON quizzes(class_id, status);

      CREATE TABLE quiz_runs (
        id         TEXT PRIMARY KEY,
        quiz_id    TEXT NOT NULL REFERENCES quizzes(id),
        class_id   TEXT NOT NULL REFERENCES classes(id),
        join_code  TEXT NOT NULL,
        status     TEXT NOT NULL CHECK (status IN ('lobby','active','ended')),
        opened_by  TEXT NOT NULL REFERENCES users(id),
        created_at INTEGER NOT NULL,
        started_at INTEGER,
        ended_at   INTEGER
      );
      CREATE INDEX quiz_runs_quiz ON quiz_runs(quiz_id, created_at);
      CREATE INDEX quiz_runs_open_code ON quiz_runs(join_code) WHERE status != 'ended';

      CREATE TABLE quiz_participants (
        run_id      TEXT NOT NULL REFERENCES quiz_runs(id),
        student_id  TEXT NOT NULL REFERENCES students(id),
        device_id   TEXT NOT NULL,
        joined_at   INTEGER NOT NULL,
        finished_at INTEGER,
        PRIMARY KEY (run_id, student_id)
      );

      -- First answer to a question wins, so a resent answer changes nothing.
      CREATE TABLE quiz_answers (
        run_id         TEXT NOT NULL REFERENCES quiz_runs(id),
        student_id     TEXT NOT NULL REFERENCES students(id),
        question_index INTEGER NOT NULL,
        choice         INTEGER NOT NULL,
        points         INTEGER NOT NULL,
        answered_at    INTEGER NOT NULL,
        PRIMARY KEY (run_id, student_id, question_index)
      );
    `,
  },
  {
    version: 4,
    name: 'ai_jobs',
    sql: `
      -- Spec 9: AI requests wait here and run one at a time. Deleted after 90 days.
      CREATE TABLE ai_jobs (
        id           TEXT PRIMARY KEY,
        kind         TEXT NOT NULL CHECK (kind IN ('quiz')),
        requested_by TEXT NOT NULL REFERENCES users(id),
        request_json TEXT NOT NULL,
        status       TEXT NOT NULL CHECK (status IN ('queued','running','done','failed')),
        result_json  TEXT,
        error        TEXT,
        created_at   INTEGER NOT NULL,
        started_at   INTEGER,
        finished_at  INTEGER
      );
      CREATE INDEX ai_jobs_queue ON ai_jobs(status, created_at);
      CREATE INDEX ai_jobs_user ON ai_jobs(requested_by, created_at);
    `,
  },
  {
    version: 5,
    name: 'quiz_run_total_marks',
    sql: `
      -- The quiz total when the run started, so editing the quiz later leaves old scores alone.
      -- Older runs keep NULL and fall back to the quiz's current total.
      ALTER TABLE quiz_runs ADD COLUMN total_marks INTEGER;
    `,
  },
  {
    version: 6,
    name: 'teacher_classes_and_subjects',
    sql: `
      -- The Super Admin decides which classes and subjects each teacher works with.
      -- A teacher with no rows here sees everything, as before.
      CREATE TABLE teacher_classes (
        user_id  TEXT NOT NULL REFERENCES users(id),
        class_id TEXT NOT NULL REFERENCES classes(id),
        PRIMARY KEY (user_id, class_id)
      );
      CREATE TABLE teacher_subjects (
        user_id TEXT NOT NULL REFERENCES users(id),
        subject TEXT NOT NULL COLLATE NOCASE,
        PRIMARY KEY (user_id, subject)
      );
    `,
  },
  {
    version: 7,
    name: 'ai_jobs_ask',
    sql: `
      -- The AI now also answers questions. SQLite cannot change a CHECK, so the table is rebuilt.
      CREATE TABLE ai_jobs_new (
        id           TEXT PRIMARY KEY,
        kind         TEXT NOT NULL CHECK (kind IN ('quiz','ask')),
        requested_by TEXT NOT NULL REFERENCES users(id),
        request_json TEXT NOT NULL,
        status       TEXT NOT NULL CHECK (status IN ('queued','running','done','failed')),
        result_json  TEXT,
        error        TEXT,
        created_at   INTEGER NOT NULL,
        started_at   INTEGER,
        finished_at  INTEGER
      );
      INSERT INTO ai_jobs_new (id, kind, requested_by, request_json, status, result_json, error, created_at, started_at, finished_at)
        SELECT id, kind, requested_by, request_json, status, result_json, error, created_at, started_at, finished_at FROM ai_jobs ORDER BY rowid;
      DROP TABLE ai_jobs;
      ALTER TABLE ai_jobs_new RENAME TO ai_jobs;
      CREATE INDEX ai_jobs_queue ON ai_jobs(status, created_at);
      CREATE INDEX ai_jobs_user ON ai_jobs(requested_by, created_at);
    `,
  },
  {
    version: 8,
    name: 'student_notes',
    sql: `
      -- "My notes": a student's own notebook. Deleting a note removes the row for good.
      CREATE TABLE student_notes (
        id         TEXT PRIMARY KEY,
        student_id TEXT NOT NULL REFERENCES students(id),
        title      TEXT NOT NULL,
        body       TEXT NOT NULL,
        subject    TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX student_notes_owner ON student_notes(student_id, updated_at);
    `,
  },
  {
    version: 9,
    name: 'notices',
    sql: `
      -- One-way notices. class_id NULL = whole school; section_id NULL = the whole class.
      -- Taking a notice down removes the row for good.
      CREATE TABLE notices (
        id         TEXT PRIMARY KEY,
        title      TEXT NOT NULL,
        body       TEXT NOT NULL,
        class_id   TEXT REFERENCES classes(id),
        section_id TEXT REFERENCES sections(id),
        pinned     INTEGER NOT NULL DEFAULT 0,
        expires_at INTEGER,
        created_by TEXT NOT NULL REFERENCES users(id),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX notices_class ON notices(class_id, created_at);
    `,
  },
  {
    version: 10,
    name: 'settings_periods_and_student_prefs',
    sql: `
      -- The periods of the school day, as the Super Admin types them. Times are "HH:MM" on the school's clock.
      CREATE TABLE periods (
        id        TEXT PRIMARY KEY,
        name      TEXT NOT NULL,
        starts_at TEXT NOT NULL,
        ends_at   TEXT NOT NULL
      );
      -- How one student likes their screens; follows the student to any lab PC.
      CREATE TABLE student_prefs (
        student_id    TEXT PRIMARY KEY REFERENCES students(id),
        text_size     TEXT NOT NULL CHECK (text_size IN ('normal','large','xlarge')),
        high_contrast INTEGER NOT NULL DEFAULT 0,
        easy_font     INTEGER NOT NULL DEFAULT 0,
        updated_at    INTEGER NOT NULL
      );
    `,
  },
  {
    version: 11,
    name: 'timetable',
    sql: `
      -- One lab, so one class per period per day. day: 1 = Monday ... 6 = Saturday.
      CREATE TABLE timetable_slots (
        day        INTEGER NOT NULL CHECK (day BETWEEN 1 AND 6),
        period_id  TEXT NOT NULL REFERENCES periods(id),
        class_id   TEXT NOT NULL REFERENCES classes(id),
        section_id TEXT REFERENCES sections(id),
        subject    TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (day, period_id)
      );
      CREATE INDEX timetable_class ON timetable_slots(class_id, day);
    `,
  },
  {
    version: 12,
    name: 'work',
    sql: `
      -- Work a teacher sets for a class (or one section). Taking it away keeps the row (deleted_at) so
      -- the answers and marks already given are not lost.
      CREATE TABLE assignments (
        id           TEXT PRIMARY KEY,
        title        TEXT NOT NULL,
        instructions TEXT NOT NULL,
        class_id     TEXT NOT NULL REFERENCES classes(id),
        section_id   TEXT REFERENCES sections(id),
        subject      TEXT,
        due_at       INTEGER,
        max_marks    INTEGER NOT NULL,
        created_by   TEXT NOT NULL REFERENCES users(id),
        created_at   INTEGER NOT NULL,
        deleted_at   INTEGER
      );
      CREATE INDEX assignments_class ON assignments(class_id, created_at);
      -- Append-only: handing in again adds a row. The newest row is the answer that counts.
      CREATE TABLE submissions (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        assignment_id TEXT NOT NULL REFERENCES assignments(id),
        student_id    TEXT NOT NULL REFERENCES students(id),
        body          TEXT NOT NULL,
        submitted_at  INTEGER NOT NULL,
        late          INTEGER NOT NULL
      );
      CREATE INDEX submissions_work ON submissions(assignment_id, student_id, id);
      CREATE TABLE work_marks (
        assignment_id TEXT NOT NULL REFERENCES assignments(id),
        student_id    TEXT NOT NULL REFERENCES students(id),
        marks         INTEGER NOT NULL,
        comment       TEXT NOT NULL,
        marked_by     TEXT NOT NULL REFERENCES users(id),
        marked_at     INTEGER NOT NULL,
        PRIMARY KEY (assignment_id, student_id)
      );
    `,
  },
  {
    version: 13,
    name: 'report_cards',
    sql: `
      -- One card per student per term. marks_json is the marks as they stood when the card was made;
      -- once the status is 'frozen' the row is never written again.
      CREATE TABLE report_cards (
        id         TEXT PRIMARY KEY,
        student_id TEXT NOT NULL REFERENCES students(id),
        class_id   TEXT NOT NULL REFERENCES classes(id),
        term       TEXT NOT NULL,
        status     TEXT NOT NULL CHECK (status IN ('draft','published','frozen')),
        remarks    TEXT NOT NULL,
        marks_json TEXT NOT NULL,
        created_by TEXT NOT NULL REFERENCES users(id),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE (student_id, term)
      );
      CREATE INDEX report_cards_class ON report_cards(class_id, term);
    `,
  },
  {
    version: 14,
    name: 'ai_jobs_tutor',
    sql: `
      -- Students can now ask the AI tutor. A job's owner is then a student, not a staff account, so
      -- requested_by no longer points at the users table. SQLite cannot change a CHECK or drop a
      -- reference, so the table is rebuilt.
      CREATE TABLE ai_jobs_new (
        id           TEXT PRIMARY KEY,
        kind         TEXT NOT NULL CHECK (kind IN ('quiz','ask','tutor')),
        requested_by TEXT NOT NULL,
        request_json TEXT NOT NULL,
        status       TEXT NOT NULL CHECK (status IN ('queued','running','done','failed')),
        result_json  TEXT,
        error        TEXT,
        created_at   INTEGER NOT NULL,
        started_at   INTEGER,
        finished_at  INTEGER
      );
      INSERT INTO ai_jobs_new (id, kind, requested_by, request_json, status, result_json, error, created_at, started_at, finished_at)
        SELECT id, kind, requested_by, request_json, status, result_json, error, created_at, started_at, finished_at FROM ai_jobs ORDER BY rowid;
      DROP TABLE ai_jobs;
      ALTER TABLE ai_jobs_new RENAME TO ai_jobs;
      CREATE INDEX ai_jobs_queue ON ai_jobs(status, created_at);
      CREATE INDEX ai_jobs_user ON ai_jobs(requested_by, created_at);
    `,
  },
  {
    version: 15,
    name: 'content_library',
    sql: `
      -- A file is kept once under its fingerprint; many library items may point at it.
      CREATE TABLE files (
        sha256     TEXT PRIMARY KEY,
        size       INTEGER NOT NULL,
        mime       TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      -- A library item: a file or a web link, filed under a class, a subject and a chapter.
      CREATE TABLE content_items (
        id             TEXT PRIMARY KEY,
        title          TEXT NOT NULL,
        kind           TEXT NOT NULL CHECK (kind IN ('pdf','image','video','audio','link')),
        class_id       TEXT NOT NULL REFERENCES classes(id),
        subject        TEXT,
        chapter        TEXT,
        file_hash      TEXT REFERENCES files(sha256),
        file_name      TEXT,
        url            TEXT,
        needs_internet INTEGER NOT NULL DEFAULT 0,
        created_by     TEXT NOT NULL REFERENCES users(id),
        created_at     INTEGER NOT NULL,
        deleted_at     INTEGER
      );
      CREATE INDEX content_class ON content_items(class_id, subject, chapter);
      CREATE INDEX content_file ON content_items(file_hash);
    `,
  },
  {
    version: 16,
    name: 'playlists_and_paths',
    sql: `
      -- A playlist or a learning path: an ordered list of steps for one class.
      CREATE TABLE sequences (
        id         TEXT PRIMARY KEY,
        type       TEXT NOT NULL CHECK (type IN ('playlist','path')),
        title      TEXT NOT NULL,
        class_id   TEXT NOT NULL REFERENCES classes(id),
        subject    TEXT,
        created_by TEXT NOT NULL REFERENCES users(id),
        created_at INTEGER NOT NULL,
        deleted_at INTEGER
      );
      CREATE INDEX sequences_class ON sequences(class_id, created_at);
      CREATE TABLE sequence_steps (
        id            TEXT PRIMARY KEY,
        sequence_id   TEXT NOT NULL REFERENCES sequences(id),
        position      INTEGER NOT NULL,
        kind          TEXT NOT NULL CHECK (kind IN ('content','work')),
        content_id    TEXT REFERENCES content_items(id),
        assignment_id TEXT REFERENCES assignments(id)
      );
      CREATE INDEX sequence_steps_order ON sequence_steps(sequence_id, position);
      -- A student opened a library step. (A work step is done when its work is handed in.)
      CREATE TABLE step_done (
        step_id    TEXT NOT NULL REFERENCES sequence_steps(id),
        student_id TEXT NOT NULL REFERENCES students(id),
        done_at    INTEGER NOT NULL,
        PRIMARY KEY (step_id, student_id)
      );
    `,
  },
];
