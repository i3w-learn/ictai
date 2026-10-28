import type { FastifyInstance, FastifyRequest } from 'fastify';
import { route } from '../../core/route.js';
import type { SessionService } from './session.service.js';
import type { StaffAuthService } from './staff-auth.service.js';

// Tokens come only from the Authorization header, never the URL (spec 11).
export function bearerToken(req: FastifyRequest): string | null {
  const h = req.headers.authorization;
  if (!h?.startsWith('Bearer ')) return null;
  return h.slice(7).trim() || null;
}

export function authRoutes(app: FastifyInstance, deps: { staffAuth: StaffAuthService; sessions: SessionService }) {
  route(app, 'POST /api/v1/auth/staff', ({ body, req }) => deps.staffAuth.signIn(body, req.ip));

  route(app, 'GET /api/v1/auth/me', ({ principal }) => principal!);

  route(app, 'POST /api/v1/auth/logout', ({ req, principal }) => {
    const token = bearerToken(req);
    // Device tokens are not ended here; a device is retired from the console instead.
    if (token && principal?.kind !== 'device') deps.sessions.end(token);
  });
}
