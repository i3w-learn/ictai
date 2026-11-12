import { randomUUID } from 'node:crypto';
import type { ClassCode, ImportResult, ImportStudents, NewStudent, SchoolClass, Section, SignInCard, StaffPrincipal, Student, UpdateStudent } from '@ict/contracts';
import type { AuditLog } from '../../core/audit.js';
import { DAY, type Clock } from '../../core/clock.js';
import { AppError, forbidden, notFound, unique } from '../../core/errors.js';
import { checkClass, checkMyClass, scopeOf, seesClass, type Scope } from '../../core/scope.js';
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

  listClasses(scope: Scope): SchoolClass[] {
    return this.classes.listClasses().filter((c) => seesClass(scope, c.id));
  }

  addClass(scope: Scope, name: string): SchoolClass {
    if (scope.classIds) throw forbidden('Only the Super Admin adds classes.');
    return unique(() => this.classes.insertClass(name, this.now()), `Class "${name}" already exists.`);
  }

  listSections(scope: Scope, classId: string): Section[] {
    this.myClass(scope, classId);
    return this.classes.listSections(classId);
  }

  addSection(scope: Scope, classId: string, name: string): Section {
    this.myClass(scope, classId);
    return unique(() => this.classes.insertSection(classId, name, this.now()), `Section "${name}" already exists.`);
  }

  async addStudent(scope: Scope, s: NewStudent): Promise<Student & { qrToken: string }> {
    this.myClass(scope, s.classId);
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

  // Each row is judged alone: good rows are added, bad ones come back with the reason.
  // Imported students have no PIN yet; they start with a first sign-in code or a card.
  importStudents(actor: StaffPrincipal, classId: string, rows: ImportStudents['rows']): ImportResult {
    this.myClass(scopeOf(actor), classId);
    const sections = new Map(this.classes.listSections(classId).map((x) => [x.name.toLowerCase(), x.id]));
    const result: ImportResult = { added: 0, skipped: [] };
    rows.forEach((r, i) => {
      const name = r.name.trim();
      const rollNo = r.rollNo?.trim() || null;
      const section = r.section?.trim() || null;
      const skip = (reason: string) => result.skipped.push({ row: i + 1, name, reason });
      if (!name) return skip('The name is empty.');
      if (name.length > 80) return skip('The name is longer than 80 letters.');
      if (rollNo && rollNo.length > 16) return skip('The roll number is longer than 16 letters.');
      const sectionId = section ? sections.get(section.toLowerCase()) : null;
      if (sectionId === undefined) return skip(`Section "${section}" is not in this class. Add the section first.`);
      if (this.students.findDuplicate(name, classId, rollNo)) return skip('Already in this class with the same roll number.');
      this.students.insert({ id: randomUUID(), name, classId, sectionId, rollNo, pinHash: null, qrTokenHash: hashToken(newToken()), now: this.now() });
      result.added++;
    });
    if (result.added > 0) this.audit.record({ kind: 'staff', id: actor.userId }, 'student.import', classId, { added: result.added });
    return result;
  }

  listStudents(scope: Scope, classId: string): Student[] {
    this.myClass(scope, classId);
    return this.students.listByClass(classId);
  }

  updateStudent(scope: Scope, id: string, u: UpdateStudent): Student {
    const st = this.students.get(id);
    if (!st) throw notFound('Student');
    checkClass(scope, st.classId);
    if (u.sectionId && !this.classes.sectionInClass(u.sectionId, st.classId)) throw notFound('Section in this class');
    const name = u.name ?? st.name;
    if (this.students.findDuplicate(name, st.classId, u.rollNo === undefined ? st.rollNo : u.rollNo, id)) throw duplicate(name);
    this.students.update(id, u, this.now());
    return this.students.get(id)!;
  }

  removeStudent(actor: StaffPrincipal, id: string) {
    this.mine(scopeOf(actor), id);
    this.students.markDeleted(id, this.now());
    this.sessions.deleteForUser('student', id);
    this.audit.record({ kind: 'staff', id: actor.userId }, 'student.delete', id);
  }

  async resetPin(scope: Scope, studentId: string, pin: string) {
    this.mine(scope, studentId);
    this.students.setPin(studentId, await hashSecret(pin), this.now());
  }

  // A one-time code for the student's first sign-in, where they choose their own PIN.
  issueEnrolmentCode(scope: Scope, studentId: string): { code: string; expiresAt: number } {
    this.mine(scope, studentId);
    return this.newCode(studentId);
  }

  // Year-end move, e.g. every Class 7 student into Class 8. Sections carry over by name.
  promote(actor: StaffPrincipal, fromClassId: string, toClassId: string): { moved: number } {
    const scope = scopeOf(actor);
    this.myClass(scope, fromClassId);
    this.myClass(scope, toClassId);
    if (fromClassId === toClassId) throw new AppError(400, 'BAD_REQUEST', 'Pick a different class to move the students into.');
    const target = new Map(this.classes.listSections(toClassId).map((x) => [x.name.toLowerCase(), x.id]));
    const sectionMap = new Map(this.classes.listSections(fromClassId).map((x) => [x.id, target.get(x.name.toLowerCase()) ?? null]));
    const moved = this.students.moveClass(fromClassId, toClassId, sectionMap, this.now());
    this.audit.record({ kind: 'staff', id: actor.userId }, 'class.promote', fromClassId, { toClassId, moved });
    return { moved };
  }

  classCodes(actor: StaffPrincipal, classId: string): ClassCode[] {
    const codes = this.codesFor(scopeOf(actor), classId);
    this.audit.record({ kind: 'staff', id: actor.userId }, 'class.codes', classId, { count: codes.length });
    return codes;
  }

  // New QR tokens replace the old ones, so cards printed earlier stop working.
  cards(actor: StaffPrincipal, classId: string): SignInCard[] {
    const now = this.now();
    const cards = this.codesFor(scopeOf(actor), classId).map((c) => {
      const qrToken = newToken();
      this.students.setQrHash(c.studentId, hashToken(qrToken), now);
      return { ...c, qrToken };
    });
    this.audit.record({ kind: 'staff', id: actor.userId }, 'class.cards', classId, { count: cards.length });
    return cards;
  }

  // The class is checked once; every student on its roster is in it by definition.
  private codesFor(scope: Scope, classId: string): ClassCode[] {
    this.myClass(scope, classId);
    return this.students.roster(classId).map((r) => ({ studentId: r.id, name: r.name, rollNo: r.rollNo, ...this.newCode(r.id) }));
  }

  // A fresh one-time code for a student the caller has already checked.
  private newCode(studentId: string): { code: string; expiresAt: number } {
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

  // An active student in one of this teacher's classes.
  private mine(scope: Scope, studentId: string) {
    const st = this.students.findActive(studentId);
    if (!st) throw notFound('Student');
    checkClass(scope, st.class_id);
  }

  // A class named in the request: it must exist and be one of this teacher's.
  private myClass(scope: Scope, classId: string) {
    checkMyClass(this.classes, scope, classId);
  }
}
