import type { FastifyInstance } from 'fastify';
import type { AuditLog } from '../../core/audit.js';
import { route } from '../../core/route.js';
import type { SchoolIdentity } from './school-identity.js';

export function systemRoutes(app: FastifyInstance, deps: { identity: SchoolIdentity; audit: AuditLog }) {
  route(app, 'GET /health', () => {
    const { serverId, schoolId, name, activated, version } = deps.identity.current();
    return { ok: true as const, serverId, schoolId, name, activated, version };
  });

  route(app, 'GET /api/v1/audit', ({ query }) => deps.audit.list(query.before));
}
