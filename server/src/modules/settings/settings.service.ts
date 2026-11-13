import { randomUUID } from 'node:crypto';
import { DEFAULT_PREFS, overlappingPeriods, type SchoolSettings, type StaffPrincipal, type StudentPrefs, type StudentPrincipal } from '@ict/contracts';
import type { AuditLog } from '../../core/audit.js';
import type { Clock } from '../../core/clock.js';
import { AppError } from '../../core/errors.js';
import type { Db } from '../../infra/db/index.js';
import type { SettingsRepository } from './settings.repository.js';

const AI_ENABLED = 'ai_enabled';

// PRD "Settings": the Super Admin's school-wide choices, and each student's own screen choices.
export class SettingsService {
  constructor(
    private readonly now: Clock,
    private readonly settings: SettingsRepository,
    private readonly audit: AuditLog,
    private readonly db: Db,
    // Told when a period is deleted, so the timetable can drop the lab slots that used it.
    private readonly onPeriodRemoved: (periodId: string) => void = () => {},
  ) {}

  school(): SchoolSettings {
    return { schoolName: this.settings.schoolName(), aiEnabled: this.aiEnabled(), periods: this.settings.periods() };
  }

  // Asked by the AI before it takes a request. On until the Super Admin switches it off.
  aiEnabled(): boolean {
    return this.settings.flag(AI_ENABLED, true);
  }

  save(actor: StaffPrincipal, input: SchoolSettings): SchoolSettings {
    const clash = overlappingPeriods(input.periods);
    if (clash) throw new AppError(400, 'BAD_REQUEST', `"${clash[0].name}" and "${clash[1].name}" overlap. Change one of their times.`);
    const names = input.periods.map((p) => p.name.toLowerCase());
    if (new Set(names).size !== names.length) throw new AppError(400, 'BAD_REQUEST', 'Two periods have the same name. Give each its own name.');

    const before = this.school();
    this.db.transaction(() => {
      this.settings.setSchoolName(input.schoolName);
      this.settings.setFlag(AI_ENABLED, input.aiEnabled);
      this.settings.replacePeriods(input.periods, randomUUID, (periodId) => this.onPeriodRemoved(periodId));
    })();
    this.audit.record({ kind: 'staff', id: actor.userId }, 'settings.change', null, {
      schoolName: before.schoolName !== input.schoolName, ai: before.aiEnabled !== input.aiEnabled, periods: input.periods.length,
    });
    return this.school();
  }

  prefs(me: StudentPrincipal): StudentPrefs {
    return this.settings.prefs(me.studentId) ?? DEFAULT_PREFS;
  }

  setPrefs(me: StudentPrincipal, prefs: StudentPrefs): StudentPrefs {
    this.settings.setPrefs(me.studentId, prefs, this.now());
    return prefs;
  }
}
