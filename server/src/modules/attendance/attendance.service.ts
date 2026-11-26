import { dayText, type AttendanceDay, type AttendanceMark, type StaffPrincipal } from '@ict/contracts';
import type { AuditLog } from '../../core/audit.js';
import type { Clock } from '../../core/clock.js';
import { AppError, notFound } from '../../core/errors.js';
import { checkClass, checkMyClass, scopeOf } from '../../core/scope.js';
import type { ClassRepository } from '../students/class.repository.js';
import type { StudentRepository } from '../students/student.repository.js';
import type { AttendanceRepository } from './attendance.repository.js';

// Spec 4.4 "Attendance": signing in on a lab PC marks a student present for that day. A teacher can
// change any student of her own classes, for today or a day gone by.
export class AttendanceService {
  constructor(
    private readonly now: Clock,
    private readonly attendance: AttendanceRepository,
    private readonly classes: ClassRepository,
    private readonly students: StudentRepository,
    private readonly audit: AuditLog,
  ) {}

  // The day comes from the server's own clock, so every lab PC agrees on what "today" is.
  private today(): string {
    return dayText(new Date(this.now()));
  }

  signedIn(studentId: string) {
    this.attendance.signedIn(studentId, this.today(), this.now());
  }

  day(actor: StaffPrincipal, classId: string, date?: string): AttendanceDay {
    checkMyClass(this.classes, scopeOf(actor), classId);
    return this.read(classId, date ?? this.today());
  }

  mark(actor: StaffPrincipal, studentId: string, input: AttendanceMark): AttendanceDay {
    const student = this.students.findActive(studentId);
    if (!student) throw notFound('Student');
    checkClass(scopeOf(actor), student.class_id);
    if (input.date > this.today()) throw new AppError(400, 'BAD_REQUEST', 'That day has not come yet.');
    this.attendance.mark(studentId, input.date, input.present, actor.userId, this.now());
    this.audit.record({ kind: 'staff', id: actor.userId }, 'attendance.mark', studentId, { date: input.date, present: input.present });
    return this.read(student.class_id, input.date);
  }

  private read(classId: string, date: string): AttendanceDay {
    return { date, today: this.today(), rows: this.attendance.forClass(classId, date) };
  }
}
