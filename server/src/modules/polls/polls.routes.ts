import type { FastifyInstance } from 'fastify';
import { asStaff, asStudent, route } from '../../core/route.js';
import type { PollService } from './poll.service.js';

export function pollRoutes(app: FastifyInstance, deps: { polls: PollService }) {
  const { polls } = deps;
  route(app, 'GET /api/v1/polls', ({ query, principal }) => polls.list(asStaff(principal), query.classId));
  route(app, 'POST /api/v1/polls', ({ body, principal }) => polls.ask(asStaff(principal), body));
  route(app, 'POST /api/v1/polls/:id/close', ({ params, principal }) => polls.close(asStaff(principal), params.id));
  route(app, 'DELETE /api/v1/polls/:id', ({ params, principal }) => polls.remove(asStaff(principal), params.id));
  route(app, 'GET /api/v1/polls/open', ({ principal }) => polls.openFor(asStudent(principal)));
  route(app, 'POST /api/v1/polls/:id/answer', ({ params, body, principal }) => polls.answer(asStudent(principal), params.id, body.choice));
}
