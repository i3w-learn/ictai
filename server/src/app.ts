import Fastify, { type FastifyServerOptions } from 'fastify';
import type { Container } from './container.js';
import { registerErrorHandler } from './core/errors.js';
import { authRoutes, bearerToken } from './modules/auth/auth.routes.js';
import { deviceRoutes } from './modules/devices/devices.routes.js';
import { studentRoutes } from './modules/students/students.routes.js';
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

  systemRoutes(app, { identity: c.identity });
  authRoutes(app, { staffAuth: c.staffAuth, sessions: c.sessions });
  deviceRoutes(app, { enrolment: c.enrolment });
  studentRoutes(app, { admin: c.studentAdmin, auth: c.studentAuth });
  return app;
}
