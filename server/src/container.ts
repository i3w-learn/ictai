import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AuditLog } from './core/audit.js';
import { DAY, type Clock } from './core/clock.js';
import type { Db } from './infra/db/index.js';
import { FailureLimiter } from './modules/auth/limiter.js';
import { PrincipalResolver } from './modules/auth/principal.resolver.js';
import { SessionRepository } from './modules/auth/session.repository.js';
import { SessionService } from './modules/auth/session.service.js';
import { StaffAuthService } from './modules/auth/staff-auth.service.js';
import { StaffRepository } from './modules/auth/staff.repository.js';
import { DeviceEnrolmentService } from './modules/devices/device-enrolment.service.js';
import { DeviceRepository } from './modules/devices/device.repository.js';
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
import { ProgressService } from './modules/results/progress.service.js';
import { NoteRepository } from './modules/notes/note.repository.js';
import { NoteService } from './modules/notes/note.service.js';
import { NoticeRepository } from './modules/notices/notice.repository.js';
import { NoticeService } from './modules/notices/notice.service.js';
import { SettingsRepository } from './modules/settings/settings.repository.js';
import { SettingsService } from './modules/settings/settings.service.js';
import { TimetableRepository } from './modules/timetable/timetable.repository.js';
import { TimetableService } from './modules/timetable/timetable.service.js';
import { WorkRepository } from './modules/work/work.repository.js';
import { WorkService } from './modules/work/work.service.js';
import { ReportCardRepository } from './modules/report-cards/report-card.repository.js';
import { ReportCardService } from './modules/report-cards/report-card.service.js';
import { ContentRepository } from './modules/content/content.repository.js';
import { ContentService } from './modules/content/content.service.js';
import { FileStore } from './modules/content/file-store.js';
import { StarterVideos } from './modules/content/starter-videos.js';
import { SequenceRepository } from './modules/sequences/sequence.repository.js';
import { SequenceService } from './modules/sequences/sequence.service.js';
import { ShowPenService } from './modules/shows/show-pen.service.js';
import { ShowService } from './modules/shows/show.service.js';
import { ShowStore } from './modules/shows/show.store.js';
import { Relay } from './relay/relay.js';
import { aiNotInstalled } from './core/errors.js';
import { AiService, type AiRuntimeInfo } from './modules/ai/ai.service.js';
import { AnswerGenerator } from './modules/ai/answer-generator.js';
import { TutorGenerator } from './modules/ai/tutor-generator.js';
import { JobQueue, type JobRunners } from './modules/ai/job-queue.js';
import { JobRepository } from './modules/ai/job.repository.js';
import { noEventLog, type EventLog } from './core/event-log.js';
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
  // Where uploaded files are kept. Left out in tests, which then use a folder that is thrown away.
  dataDir?: string;
  // The folder of videos that come with the app. Left out, the server has none to add.
  starterDir?: string;
  ai?: { runtime: AiRuntimeInfo & { ensureReady?(): Promise<void> }; llm: Llm };
  // The server's diary (events.log). Left out in tests, which then write nothing.
  log?: EventLog;
}) {
  const { db, now } = opts;

  const repos = {
    sessions: new SessionRepository(db),
    staff: new StaffRepository(db),
    devices: new DeviceRepository(db),
    classes: new ClassRepository(db),
    students: new StudentRepository(db),
    quizzes: new QuizRepository(db),
    runs: new RunRepository(db),
    aiJobs: new JobRepository(db),
    results: new ResultsRepository(db),
    notes: new NoteRepository(db),
    notices: new NoticeRepository(db),
    settings: new SettingsRepository(db),
    timetable: new TimetableRepository(db),
    work: new WorkRepository(db),
    reportCards: new ReportCardRepository(db),
    content: new ContentRepository(db),
    sequences: new SequenceRepository(db),
  };

  const audit = new AuditLog(db, now);
  audit.forgetAiText(now() - 90 * DAY);
  const relay = new Relay(now, (err) => console.error('[relay]', err));
  const identity = new SchoolIdentity(db, opts.version);
  identity.ensure(now());

  const resolver = new PrincipalResolver(now, repos.sessions, repos.staff, repos.students, repos.devices);
  const sessions = new SessionService(now, repos.sessions, resolver);

  const ai: { runtime: AiRuntimeInfo & { ensureReady?(): Promise<void> }; llm: Llm } = opts.ai ?? noAi;
  const generator = new QuizGenerator(ai.llm, (id) => repos.classes.name(id) ?? null);
  const load = ai.runtime.ensureReady?.bind(ai.runtime);
  const answers = new AnswerGenerator(ai.llm);
  const tutor = new TutorGenerator(ai.llm);
  const runners = {
    quiz: (req, signal) => generator.generate(req, signal),
    ask: (req, signal) => answers.answer(req, signal),
    tutor: (req, signal) => tutor.answer(req, signal),
  } satisfies JobRunners;
  const aiQueue = new JobQueue(now, repos.aiJobs, runners, undefined, load);

  const results = new ResultsService(repos.results, repos.classes);
  const timetable = new TimetableService(now, repos.timetable, repos.classes, () => repos.settings.periods(), audit);
  const settings = new SettingsService(now, repos.settings, audit, db, (periodId) => timetable.dropPeriod(periodId));

  const fileStore = new FileStore(opts.dataDir ?? mkdtempSync(join(tmpdir(), 'ict-files-')));
  // Is this student signed in on a lab PC right now? A student who has left cannot hold the pen.
  const signedIn = (studentId: string) => repos.sessions.liveStudentDevice(studentId, '', now()) !== undefined;
  const showStore = new ShowStore(now, repos.content, signedIn, opts.log);
  const showPens = new ShowPenService(showStore, relay, signedIn, opts.log);

  const firstAdmin = () => db.prepare("SELECT id FROM users WHERE role = 'super_admin' AND status = 'active' ORDER BY created_at LIMIT 1").pluck().get() as string | undefined;

  return {
    audit,
    relay,
    starter: opts.starterDir
      ? new StarterVideos(opts.starterDir, join(opts.dataDir ?? tmpdir(), 'starter-videos.json'), now, repos.content, fileStore, repos.classes, firstAdmin, opts.log ?? noEventLog)
      : null,
    identity,
    resolver,
    sessions,
    aiQueue,
    ai: new AiService(ai.runtime, aiQueue, repos.classes, audit, () => settings.aiEnabled(), now),
    settings,
    timetable,
    work: new WorkService(now, repos.work, repos.classes, audit),
    content: new ContentService(now, repos.content, fileStore, repos.classes, audit),
    shows: new ShowService(now, showStore, showPens, repos.content, repos.classes, repos.devices, relay, audit, opts.log),
    showPens,
    sequences: new SequenceService(now, repos.sequences, repos.content, repos.work, repos.classes, audit),
    reportCards: new ReportCardService(now, repos.reportCards, repos.classes, repos.students, results, repos.work, audit),
    staffAuth: new StaffAuthService(now, repos.staff, sessions, new FailureLimiter(now), audit),
    staffAdmin: new StaffAdminService(now, repos.staff, repos.sessions, repos.classes, audit),
    enrolment: new DeviceEnrolmentService(now, repos.devices, identity, new FailureLimiter(now), audit, repos.sessions, db),
    studentAdmin: new StudentAdminService(now, repos.classes, repos.students, repos.sessions, audit),
    quizzes: new QuizService(now, repos.quizzes, repos.runs, repos.classes, audit),
    runs: new RunService(now, repos.runs, repos.quizzes, repos.classes, relay, audit),
    results,
    progress: new ProgressService(now, results, repos.work),
    notes: new NoteService(now, repos.notes),
    notices: new NoticeService(now, repos.notices, repos.classes, audit),
    studentAuth: new StudentAuthService(now, repos.classes, repos.students, sessions, audit, repos.sessions, repos.devices),
  };
}

export type Container = ReturnType<typeof createContainer>;
