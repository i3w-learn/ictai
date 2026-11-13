import type { FastifyInstance } from 'fastify';
import { asStaff, asStudent, route } from '../../core/route.js';
import type { SequenceService } from './sequence.service.js';

export function sequenceRoutes(app: FastifyInstance, deps: { sequences: SequenceService }) {
  const { sequences } = deps;
  route(app, 'GET /api/v1/sequences', ({ principal }) => sequences.list(asStaff(principal)));
  route(app, 'POST /api/v1/sequences', ({ body, principal }) => sequences.create(asStaff(principal), body));
  route(app, 'DELETE /api/v1/sequences/:id', ({ params, principal }) => sequences.remove(asStaff(principal), params.id));
  route(app, 'GET /api/v1/todo', ({ principal }) => sequences.todo(asStudent(principal)));
  route(app, 'POST /api/v1/todo/steps/:id/done', ({ params, principal }) => sequences.markDone(asStudent(principal), params.id));
}
