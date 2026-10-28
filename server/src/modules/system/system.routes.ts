import type { FastifyInstance } from 'fastify';
import { route } from '../../core/route.js';
import type { SchoolIdentity } from './school-identity.js';

export function systemRoutes(app: FastifyInstance, deps: { identity: SchoolIdentity }) {
  route(app, 'GET /health', () => {
    const { serverId, schoolId, name, activated, version } = deps.identity.current();
    return { ok: true as const, serverId, schoolId, name, activated, version };
  });
}
