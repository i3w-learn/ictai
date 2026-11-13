import { SCHOOL_DAYS, schoolDayOf, type Period, type SlotInput, type StaffPrincipal, type StudentPrincipal, type StudentToday, type Timetable } from '@ict/contracts';
import type { AuditLog } from '../../core/audit.js';
import type { Clock } from '../../core/clock.js';
import { AppError, notFound } from '../../core/errors.js';
import { checkMyClass, scopeOf, seesClass, type Scope } from '../../core/scope.js';
import type { ClassRepository } from '../students/class.repository.js';
import type { TimetableRepository } from './timetable.repository.js';

// PRD "Timetable": which class has the lab in which period, Monday to Saturday.
// Every staff member sees the whole grid (to know when the lab is free). A teacher limited to some
// classes books the lab only for those, and cannot push another teacher's class out of a period.
export class TimetableService {
  constructor(
    private readonly now: Clock,
    private readonly slots: TimetableRepository,
    private readonly classes: ClassRepository,
    private readonly periods: () => Period[],
    private readonly audit: AuditLog,
  ) {}

  get(): Timetable {
    return { periods: this.periods(), slots: this.slots.all() };
  }

  set(actor: StaffPrincipal, input: SlotInput): Timetable {
    const scope = scopeOf(actor);
    const period = this.period(input.periodId);
    checkMyClass(this.classes, scope, input.classId);
    if (input.sectionId !== null && !this.classes.sectionInClass(input.sectionId, input.classId)) {
      throw new AppError(400, 'BAD_REQUEST', 'That section is not in this class.');
    }
    this.checkFree(scope, input.day, period);
    this.slots.put(input, this.now());
    this.audit.record({ kind: 'staff', id: actor.userId }, 'timetable.set', null, { day: SCHOOL_DAYS[input.day - 1], period: period.name, classId: input.classId });
    return this.get();
  }

  clear(actor: StaffPrincipal, day: number, periodId: string): Timetable {
    const period = this.period(periodId);
    this.checkFree(scopeOf(actor), day, period);
    this.slots.clear(day, periodId);
    this.audit.record({ kind: 'staff', id: actor.userId }, 'timetable.clear', null, { day: SCHOOL_DAYS[day - 1], period: period.name });
    return this.get();
  }

  // Called when the Super Admin deletes a period in Settings.
  dropPeriod(periodId: string) {
    this.slots.clearPeriod(periodId);
  }

  // The day comes from the server's own clock, so every lab PC agrees on what "today" is.
  today(me: StudentPrincipal): StudentToday {
    const day = schoolDayOf(new Date(this.now()));
    if (day === null || day > SCHOOL_DAYS.length) return { dayName: null, periods: [] };
    return { dayName: SCHOOL_DAYS[day - 1]!, periods: this.slots.forStudent(day, me.classId, me.sectionId) };
  }

  private period(id: string): Period {
    const period = this.periods().find((p) => p.id === id);
    if (!period) throw notFound('Period');
    return period;
  }

  // The clash check: a slot already held by a class this person does not teach stays as it is.
  private checkFree(scope: Scope, day: number, period: Period) {
    const there = this.slots.at(day, period.id!);
    if (there && !seesClass(scope, there.classId)) {
      throw new AppError(409, 'LAB_TAKEN', `Class ${there.className} has the lab on ${SCHOOL_DAYS[day - 1]} in ${period.name}. Ask the Super Admin to change it.`);
    }
  }
}
