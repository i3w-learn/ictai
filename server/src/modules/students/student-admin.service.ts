import { randomUUID } from 'node:crypto';
import type { NewStudent, SchoolClass, Section, Student } from '@ict/contracts';
import { DAY, type Clock } from '../../core/clock.js';
import { AppError, notFound } from '../../core/errors.js';
import { hashSecret, hashToken, newToken, sixDigitCode } from '../auth/secrets.js';
import type { ClassRepository } from './class.repository.js';
import type { StudentRepository } from './student.repository.js';

const ENROL_CODE_TTL = 7 * DAY;

// Staff-side management of classes, sections and student sign-in credentials.
export class StudentAdminService {
  constructor(
    private readonly now: Clock,
    private readonly classes: ClassRepository,
    private readonly students: StudentRepository,
  ) {}

  listClasses(): SchoolClass[] {
    return this.classes.listClasses();
  }

  addClass(name: string): SchoolClass {
    return unique(() => this.classes.insertClass(name, this.now()), `Class "${name}" already exists.`);
  }

  addSection(classId: string, name: string): Section {
    if (!this.classes.classExists(classId)) throw notFound('Class');
    return unique(() => this.classes.insertSection(classId, name, this.now()), `Section "${name}" already exists.`);
  }

  async addStudent(s: NewStudent): Promise<Student & { qrToken: string }> {
    if (!this.classes.classExists(s.classId)) throw notFound('Class');
    if (s.sectionId && !this.classes.sectionInClass(s.sectionId, s.classId)) throw notFound('Section in this class');
    const qrToken = newToken();
    const student = this.students.insert({
      id: randomUUID(),
      name: s.name,
      classId: s.classId,
      sectionId: s.sectionId,
      rollNo: s.rollNo,
      pinHash: s.pin ? await hashSecret(s.pin) : null,
      qrTokenHash: hashToken(qrToken),
      now: this.now(),
    });
    return { ...student, qrToken };
  }

  listStudents(classId: string): Student[] {
    return this.students.listByClass(classId);
  }

  async resetPin(studentId: string, pin: string) {
    if (!this.students.findActive(studentId)) throw notFound('Student');
    this.students.setPin(studentId, await hashSecret(pin), this.now());
  }

  // A one-time code for the student's first sign-in, where they choose their own PIN.
  issueEnrolmentCode(studentId: string): { code: string; expiresAt: number } {
    if (!this.students.findActive(studentId)) throw notFound('Student');
    const now = this.now();
    for (let tries = 0; tries < 20; tries++) {
      const code = sixDigitCode();
      if (this.students.enrolCodeInUse(hashToken(code), now)) continue;
      const expiresAt = now + ENROL_CODE_TTL;
      this.students.setEnrolCode(studentId, hashToken(code), expiresAt, now);
      return { code, expiresAt };
    }
    throw new AppError(503, 'BUSY', 'Could not make a free code. Try again.');
  }
}

function unique<T>(insert: () => T, message: string): T {
  try {
    return insert();
  } catch (err) {
    if ((err as { code?: string }).code === 'SQLITE_CONSTRAINT_UNIQUE') throw new AppError(409, 'ALREADY_EXISTS', message);
    throw err;
  }
}
