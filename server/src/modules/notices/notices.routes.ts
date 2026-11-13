import type { FastifyInstance } from 'fastify';
import { asStaff, asStudent, route } from '../../core/route.js';
import type { NoticeService } from './notice.service.js';

export function noticeRoutes(app: FastifyInstance, deps: { notices: NoticeService }) {
  const { notices } = deps;
  route(app, 'GET /api/v1/notices', ({ principal }) => notices.list(asStaff(principal)));
  route(app, 'POST /api/v1/notices', ({ body, principal }) => notices.create(asStaff(principal), body));
  route(app, 'PUT /api/v1/notices/:id', ({ params, body, principal }) => notices.replace(asStaff(principal), params.id, body));
  route(app, 'DELETE /api/v1/notices/:id', ({ params, principal }) => notices.remove(asStaff(principal), params.id));
  route(app, 'GET /api/v1/notices/mine', ({ principal }) => notices.forStudent(asStudent(principal)));
}
