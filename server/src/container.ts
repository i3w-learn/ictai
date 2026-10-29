import { AuditLog } from './core/audit.js';
import type { Clock } from './core/clock.js';
import type { Db } from './infra/db/index.js';
import { FailureLimiter } from './modules/auth/limiter.js';
import { PrincipalResolver } from './modules/auth/principal.resolver.js';
import { SessionRepository } from './modules/auth/session.repository.js';
import { SessionService } from './modules/auth/session.service.js';
import { StaffAuthService } from './modules/auth/staff-auth.service.js';
import { StaffRepository } from './modules/auth/staff.repository.js';
import { DeviceEnrolmentService } from './modules/devices/device-enrolment.service.js';
import { DeviceRepository } from './modules/devices/device.repository.js';
import { EnrolWindowRepository } from './modules/devices/enrol-window.repository.js';
import { ClassRepository } from './modules/students/class.repository.js';
import { StudentAdminService } from './modules/students/student-admin.service.js';
import { StudentAuthService } from './modules/students/student-auth.service.js';
import { StudentRepository } from './modules/students/student.repository.js';
import { StaffAdminService } from './modules/staff/staff-admin.service.js';
import { QuizRepository } from './modules/quizzes/quiz.repository.js';
import { QuizService } from './modules/quizzes/quiz.service.js';
import { RunRepository } from './modules/quizzes/run.repository.js';
import { RunService } from './modules/quizzes/run.service.js';
import { Relay } from './relay/relay.js';
import { SchoolIdentity } from './modules/system/school-identity.js';

// The one place that builds and wires every object. Everything else receives what it needs.
export function createContainer(opts: { db: Db; now: Clock; version: string }) {
  const { db, now } = opts;

  const repos = {
    sessions: new SessionRepository(db),
    staff: new StaffRepository(db),
    devices: new DeviceRepository(db),
    enrolWindows: new EnrolWindowRepository(db),
    classes: new ClassRepository(db),
    students: new StudentRepository(db),
    quizzes: new QuizRepository(db),
    runs: new RunRepository(db),
  };

  const audit = new AuditLog(db, now);
  const relay = new Relay(now, (err) => console.error('[relay]', err));
  const identity = new SchoolIdentity(db, opts.version);
  identity.ensure(now());

  const resolver = new PrincipalResolver(now, repos.sessions, repos.staff, repos.students, repos.devices);
  const sessions = new SessionService(now, repos.sessions, resolver);

  return {
    audit,
    relay,
    identity,
    resolver,
    sessions,
    staffAuth: new StaffAuthService(now, repos.staff, sessions, new FailureLimiter(now), audit),
    staffAdmin: new StaffAdminService(now, repos.staff, repos.sessions, audit),
    enrolment: new DeviceEnrolmentService(now, repos.enrolWindows, repos.devices, identity, new FailureLimiter(now), audit),
    studentAdmin: new StudentAdminService(now, repos.classes, repos.students, repos.sessions, audit),
    quizzes: new QuizService(now, repos.quizzes, repos.runs, repos.classes),
    runs: new RunService(now, repos.runs, repos.quizzes, repos.classes, relay, new FailureLimiter(now), audit),
    studentAuth: new StudentAuthService(now, repos.classes, repos.students, sessions, new FailureLimiter(now), audit),
  };
}

export type Container = ReturnType<typeof createContainer>;
