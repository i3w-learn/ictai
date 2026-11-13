import Fastify, { type FastifyServerOptions } from 'fastify';
import type { Container } from './container.js';
import { registerErrorHandler } from './core/errors.js';
import { authRoutes, bearerToken } from './modules/auth/auth.routes.js';
import { deviceRoutes } from './modules/devices/devices.routes.js';
import { staffRoutes } from './modules/staff/staff.routes.js';
import { studentRoutes } from './modules/students/students.routes.js';
import { quizRoutes } from './modules/quizzes/quizzes.routes.js';
import { aiRoutes } from './modules/ai/ai.routes.js';
import { resultRoutes } from './modules/results/results.routes.js';
import { noteRoutes } from './modules/notes/notes.routes.js';
import { noticeRoutes } from './modules/notices/notices.routes.js';
import { settingsRoutes } from './modules/settings/settings.routes.js';
import { timetableRoutes } from './modules/timetable/timetable.routes.js';
import { workRoutes } from './modules/work/work.routes.js';
import { reportCardRoutes } from './modules/report-cards/report-cards.routes.js';
import { contentRoutes } from './modules/content/content.routes.js';
import { sequenceRoutes } from './modules/sequences/sequences.routes.js';
import { relayRoutes } from './relay/relay.routes.js';
import { systemRoutes } from './modules/system/system.routes.js';

declare module 'fastify' {
  interface FastifyRequest {
    principal: import('@ict/contracts').Principal | null;
  }
}

export interface AppOptions {
  https?: { key: string; cert: string };
  logger?: boolean;
}

export function buildApp(c: Container, opts: AppOptions = {}) {
  // trustProxy stays off: the real socket address is the client IP (spec 11).
  // Cast: Fastify types an HTTPS server separately, but routes don't care which one it is.
  const options = { logger: false, bodyLimit: 1024 * 1024, ...opts, trustProxy: false };
  const app = Fastify(options as FastifyServerOptions);

  registerErrorHandler(app);
  app.decorateRequest('principal', null);
  app.addHook('onRequest', async (req) => {
    req.principal = c.resolver.resolve(bearerToken(req));
  });

  relayRoutes(app, { relay: c.relay, resolver: c.resolver });
  systemRoutes(app, { identity: c.identity, audit: c.audit });
  authRoutes(app, { staffAuth: c.staffAuth, sessions: c.sessions });
  deviceRoutes(app, { enrolment: c.enrolment });
  staffRoutes(app, { admin: c.staffAdmin });
  quizRoutes(app, { quizzes: c.quizzes, runs: c.runs });
  studentRoutes(app, { admin: c.studentAdmin, auth: c.studentAuth });
  aiRoutes(app, { ai: c.ai });
  resultRoutes(app, { results: c.results, progress: c.progress });
  noteRoutes(app, { notes: c.notes });
  noticeRoutes(app, { notices: c.notices });
  settingsRoutes(app, { settings: c.settings });
  timetableRoutes(app, { timetable: c.timetable });
  workRoutes(app, { work: c.work });
  reportCardRoutes(app, { reportCards: c.reportCards });
  contentRoutes(app, { content: c.content });
  sequenceRoutes(app, { sequences: c.sequences });
  return app;
}
