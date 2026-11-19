import type { FastifyInstance } from 'fastify';
import { asStaff, asStudent, route } from '../../core/route.js';
import type { ShowPenService } from './show-pen.service.js';
import type { ShowService } from './show.service.js';

export function showRoutes(app: FastifyInstance, deps: { shows: ShowService; pens: ShowPenService }) {
  const { shows, pens } = deps;
  route(app, 'POST /api/v1/shows', ({ body, principal }) => shows.start(asStaff(principal), body));
  route(app, 'PUT /api/v1/shows/:id/page', ({ params, body, principal }) => shows.page(asStaff(principal), params.id, body));
  route(app, 'PUT /api/v1/shows/:id', ({ params, body, principal }) => shows.update(asStaff(principal), params.id, body));
  route(app, 'POST /api/v1/shows/:id/beat', ({ params, principal }) => shows.beat(asStaff(principal), params.id));
  route(app, 'DELETE /api/v1/shows/:id', ({ params, principal }) => shows.stop(asStaff(principal), params.id));
  route(app, 'POST /api/v1/shows/:id/screen', ({ params, body, principal }) => shows.screen(asStudent(principal), params.id, body));
  route(app, 'GET /api/v1/shows/:id/ink', ({ params, principal }) => pens.ink(principal!, params.id));
  route(app, 'POST /api/v1/shows/:id/ink', ({ params, body, principal }) => pens.write(principal!, params.id, body));
  route(app, 'DELETE /api/v1/shows/:id/ink/:strokeId', ({ params, principal }) => pens.erase(principal!, params.id, params.strokeId));
  route(app, 'DELETE /api/v1/shows/:id/ink', ({ params, query, principal }) => pens.clear(asStaff(principal), params.id, query.page));
  route(app, 'PUT /api/v1/shows/:id/pen', ({ params, body, principal }) => pens.givePen(asStaff(principal), params.id, body.studentId));
  route(app, 'POST /api/v1/shows/:id/pen/ask', ({ params, principal }) => pens.ask(asStudent(principal), params.id));
  route(app, 'DELETE /api/v1/shows/:id/pen/ask', ({ params, principal }) => pens.unask(asStudent(principal), params.id));
  route(app, 'DELETE /api/v1/shows/:id/pen/asks/:studentId', ({ params, principal }) => pens.refuse(asStaff(principal), params.id, params.studentId));
  route(app, 'GET /api/v1/shows/mine', ({ principal }) => shows.forStudent(asStudent(principal)));
}
