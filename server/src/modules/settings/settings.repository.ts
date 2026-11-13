import type { Period, StudentPrefs } from '@ict/contracts';
import type { Db } from '../../infra/db/index.js';

export class SettingsRepository {
  constructor(private readonly db: Db) {}

  schoolName(): string {
    return this.db.prepare('SELECT name FROM school WHERE id = 1').pluck().get() as string;
  }

  setSchoolName(name: string) {
    this.db.prepare('UPDATE school SET name = ? WHERE id = 1').run(name);
  }

  // Switches live in the small key-value table. No row means the default.
  flag(key: string, fallback: boolean): boolean {
    const v = this.db.prepare('SELECT value FROM meta WHERE key = ?').pluck().get(key) as string | undefined;
    return v === undefined ? fallback : v === '1';
  }

  setFlag(key: string, on: boolean) {
    this.db.prepare('INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, on ? '1' : '0');
  }

  periods(): Period[] {
    return this.db.prepare('SELECT id, name, starts_at AS start, ends_at AS "end" FROM periods ORDER BY starts_at').all() as Period[];
  }

  // Saved in one step, so a half-saved school day never exists. A period that is still in the list keeps
  // its id (and so its timetable entries); one left out is removed, and `onRemove` clears what pointed at it.
  replacePeriods(periods: Period[], newId: () => string, onRemove: (periodId: string) => void) {
    this.db.transaction(() => {
      const keep = new Set(periods.map((p) => p.id).filter(Boolean));
      for (const old of this.periods()) {
        if (!keep.has(old.id!)) {
          onRemove(old.id!);
          this.db.prepare('DELETE FROM periods WHERE id = ?').run(old.id);
        }
      }
      const put = this.db.prepare(
        `INSERT INTO periods (id, name, starts_at, ends_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET name = excluded.name, starts_at = excluded.starts_at, ends_at = excluded.ends_at`,
      );
      for (const p of periods) put.run(p.id ?? newId(), p.name, p.start, p.end);
    })();
  }

  prefs(studentId: string): StudentPrefs | undefined {
    const r = this.db.prepare('SELECT text_size AS textSize, high_contrast AS highContrast, easy_font AS easyFont FROM student_prefs WHERE student_id = ?').get(studentId) as
      | { textSize: StudentPrefs['textSize']; highContrast: number; easyFont: number }
      | undefined;
    return r && { textSize: r.textSize, highContrast: !!r.highContrast, easyFont: !!r.easyFont };
  }

  setPrefs(studentId: string, p: StudentPrefs, now: number) {
    this.db
      .prepare(
        `INSERT INTO student_prefs (student_id, text_size, high_contrast, easy_font, updated_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(student_id) DO UPDATE SET text_size = excluded.text_size, high_contrast = excluded.high_contrast, easy_font = excluded.easy_font, updated_at = excluded.updated_at`,
      )
      .run(studentId, p.textSize, p.highContrast ? 1 : 0, p.easyFont ? 1 : 0, now);
  }
}
