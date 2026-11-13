import type { FastifyInstance } from 'fastify';
import { asStaff, asStudent, route } from '../../core/route.js';
import type { WorkService } from './work.service.js';

export function workRoutes(app: FastifyInstance, deps: { work: WorkService }) {
  const { work } = deps;
  route(app, 'GET /api/v1/assignments', ({ principal }) => work.list(asStaff(principal)));
  route(app, 'POST /api/v1/assignments', ({ body, principal }) => work.create(asStaff(principal), body));
  route(app, 'GET /api/v1/assignments/:id', ({ params, principal }) => work.detail(asStaff(principal), params.id));
  route(app, 'DELETE /api/v1/assignments/:id', ({ params, principal }) => work.remove(asStaff(principal), params.id));
  route(app, 'PUT /api/v1/assignments/:id/marks/:studentId', ({ params, body, principal }) => work.mark(asStaff(principal), params.id, params.studentId, body));
  route(app, 'GET /api/v1/work', ({ principal }) => work.mineAsStudent(asStudent(principal)));
  route(app, 'POST /api/v1/work/:id/answers', ({ params, body, principal }) => work.submit(asStudent(principal), params.id, body.body));
}
