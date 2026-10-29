import { randomUUID } from 'node:crypto';
import type { ClassCode, NewStudent, SchoolClass, Section, SignInCard, StaffPrincipal, Student, UpdateStudent } from '@ict/contracts';
import type { AuditLog } from '../../core/audit.js';
import { DAY, type Clock } from '../../core/clock.js';
import { AppError, notFound, unique } from '../../core/errors.js';
import type { SessionRepository } from '../auth/session.repository.js';
import { hashSecret, hashToken, newToken, sixDigitCode } from '../auth/secrets.js';
import type { ClassRepository } from './class.repository.js';
import type { StudentRepository } from './student.repository.js';

const ENROL_CODE_TTL = 7 * DAY;

const duplicate = (name: string) =>
  new AppError(409, 'ALREADY_EXISTS', `${name} is already in this class with the same roll number.`);

// Staff-side management of classes, sections and student sign-in credentials.
export class StudentAdminService {
  constructor(
    private readonly now: Clock,
    private readonly classes: ClassRepository,
    private readonly students: StudentRepository,
    private readonly sessions: SessionRepository,
    private readonly audit: AuditLog,
  ) {}

  listClasses(): SchoolClass[] {
    return this.classes.listClasses();
  }

  addClass(name: string): SchoolClass {
    return unique(() => this.classes.insertClass(name, this.now()), `Class "${name}" already exists.`);
  }

  listSections(classId: string): Section[] {
    return this.classes.listSections(classId);
  }

  addSection(classId: string, name: string): Section {
    if (!this.classes.classExists(classId)) throw notFound('Class');
    return unique(() => this.classes.insertSection(classId, name, this.now()), `Section "${name}" already exists.`);
  }

  async addStudent(s: NewStudent): Promise<Student & { qrToken: string }> {
    if (!this.classes.classExists(s.classId)) throw notFound('Class');
    if (s.sectionId && !this.classes.sectionInClass(s.sectionId, s.classId)) throw notFound('Section in this class');
    if (this.students.findDuplicate(s.name, s.classId, s.rollNo)) throw duplicate(s.name);
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

  updateStudent(id: string, u: UpdateStudent): Student {
    const st = this.students.get(id);
    if (!st) throw notFound('Student');
    if (u.sectionId && !this.classes.sectionInClass(u.sectionId, st.classId)) throw notFound('Section in this class');
    const name = u.name ?? st.name;
    if (this.students.findDuplicate(name, st.classId, u.rollNo === undefined ? st.rollNo : u.rollNo, id)) throw duplicate(name);
    this.students.update(id, u, this.now());
    return this.students.get(id)!;
  }

  removeStudent(actor: StaffPrincipal, id: string) {
    if (!this.students.findActive(id)) throw notFound('Student');
    this.students.markDeleted(id, this.now());
    this.sessions.deleteForUser('student', id);
    this.audit.record({ kind: 'staff', id: actor.userId }, 'student.delete', id);
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

  // Year-end move, e.g. every Class 7 student into Class 8. Sections carry over by name.
  promote(actor: StaffPrincipal, fromClassId: string, toClassId: string): { moved: number } {
    if (!this.classes.classExists(fromClassId) || !this.classes.classExists(toClassId)) throw notFound('Class');
    if (fromClassId === toClassId) throw new AppError(400, 'BAD_REQUEST', 'Pick a different class to move the students into.');
    const target = new Map(this.classes.listSections(toClassId).map((x) => [x.name.toLowerCase(), x.id]));
    const sectionMap = new Map(this.classes.listSections(fromClassId).map((x) => [x.id, target.get(x.name.toLowerCase()) ?? null]));
    const moved = this.students.moveClass(fromClassId, toClassId, sectionMap, this.now());
    this.audit.record({ kind: 'staff', id: actor.userId }, 'class.promote', fromClassId, { toClassId, moved });
    return { moved };
  }

  classCodes(actor: StaffPrincipal, classId: string): ClassCode[] {
    const codes = this.codesFor(classId);
    this.audit.record({ kind: 'staff', id: actor.userId }, 'class.codes', classId, { count: codes.length });
    return codes;
  }

  // New QR tokens replace the old ones, so cards printed earlier stop working.
  cards(actor: StaffPrincipal, classId: string): SignInCard[] {
    const now = this.now();
    const cards = this.codesFor(classId).map((c) => {
      const qrToken = newToken();
      this.students.setQrHash(c.studentId, hashToken(qrToken), now);
      return { ...c, qrToken };
    });
    this.audit.record({ kind: 'staff', id: actor.userId }, 'class.cards', classId, { count: cards.length });
    return cards;
  }

  private codesFor(classId: string): ClassCode[] {
    if (!this.classes.classExists(classId)) throw notFound('Class');
    return this.students.roster(classId).map((r) => ({ studentId: r.id, name: r.name, rollNo: r.rollNo, ...this.issueEnrolmentCode(r.id) }));
  }
}
