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
import { ResultsRepository } from './modules/results/results.repository.js';
import { ResultsService } from './modules/results/results.service.js';
import { Relay } from './relay/relay.js';
import { aiNotInstalled } from './core/errors.js';
import { AiService, type AiRuntimeInfo } from './modules/ai/ai.service.js';
import { AnswerGenerator } from './modules/ai/answer-generator.js';
import { JobQueue, type JobRunners } from './modules/ai/job-queue.js';
import { JobRepository } from './modules/ai/job.repository.js';
import type { Llm } from './modules/ai/llm-client.js';
import { QuizGenerator } from './modules/ai/quiz-generator.js';
import { SchoolIdentity } from './modules/system/school-identity.js';

// Without an AI kit the server still runs; every AI request answers AI_NOT_INSTALLED.
const noAi: { runtime: AiRuntimeInfo; llm: Llm } = {
  runtime: { installed: () => null, isReady: () => false },
  llm: { json: () => Promise.reject(aiNotInstalled()) },
};

// The one place that builds and wires every object. Everything else receives what it needs.
export function createContainer(opts: {
  db: Db;
  now: Clock;
  version: string;
  ai?: { runtime: AiRuntimeInfo & { ensureReady?(): Promise<void> }; llm: Llm };
}) {
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
    aiJobs: new JobRepository(db),
    results: new ResultsRepository(db),
  };

  const audit = new AuditLog(db, now);
  const relay = new Relay(now, (err) => console.error('[relay]', err));
  const identity = new SchoolIdentity(db, opts.version);
  identity.ensure(now());

  const resolver = new PrincipalResolver(now, repos.sessions, repos.staff, repos.students, repos.devices);
  const sessions = new SessionService(now, repos.sessions, resolver);

  const ai: { runtime: AiRuntimeInfo & { ensureReady?(): Promise<void> }; llm: Llm } = opts.ai ?? noAi;
  const generator = new QuizGenerator(ai.llm, (id) => repos.classes.name(id) ?? null);
  const load = ai.runtime.ensureReady?.bind(ai.runtime);
  const answers = new AnswerGenerator(ai.llm);
  const runners = {
    quiz: (req, signal) => generator.generate(req, signal),
    ask: (req, signal) => answers.answer(req, signal),
  } satisfies JobRunners;
  const aiQueue = new JobQueue(now, repos.aiJobs, runners, undefined, load);

  return {
    audit,
    relay,
    identity,
    resolver,
    sessions,
    aiQueue,
    ai: new AiService(ai.runtime, aiQueue, repos.classes, audit),
    staffAuth: new StaffAuthService(now, repos.staff, sessions, new FailureLimiter(now), audit),
    staffAdmin: new StaffAdminService(now, repos.staff, repos.sessions, repos.classes, audit),
    enrolment: new DeviceEnrolmentService(now, repos.enrolWindows, repos.devices, identity, new FailureLimiter(now), audit),
    studentAdmin: new StudentAdminService(now, repos.classes, repos.students, repos.sessions, audit),
    quizzes: new QuizService(now, repos.quizzes, repos.runs, repos.classes),
    runs: new RunService(now, repos.runs, repos.quizzes, repos.classes, relay, new FailureLimiter(now), audit),
    results: new ResultsService(repos.results, repos.classes),
    studentAuth: new StudentAuthService(now, repos.classes, repos.students, sessions, new FailureLimiter(now), audit),
  };
}

export type Container = ReturnType<typeof createContainer>;
