import type { FastifyInstance } from 'fastify';
import { asStaff, asStudent, route } from '../../core/route.js';
import type { ShowService } from './show.service.js';

export function showRoutes(app: FastifyInstance, deps: { shows: ShowService }) {
  const { shows } = deps;
  route(app, 'POST /api/v1/shows', ({ body, principal }) => shows.start(asStaff(principal), body.contentId));
  route(app, 'PUT /api/v1/shows/:id', ({ params, body, principal }) => shows.update(asStaff(principal), params.id, body));
  route(app, 'DELETE /api/v1/shows/:id', ({ params, principal }) => shows.stop(asStaff(principal), params.id));
  route(app, 'GET /api/v1/shows/mine', ({ principal }) => shows.forStudent(asStudent(principal)));
}
