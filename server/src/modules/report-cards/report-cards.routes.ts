import type { FastifyInstance } from 'fastify';
import { asStaff, route } from '../../core/route.js';
import type { ReportCardService } from './report-card.service.js';

export function reportCardRoutes(app: FastifyInstance, deps: { reportCards: ReportCardService }) {
  const { reportCards } = deps;
  route(app, 'POST /api/v1/report-cards/make', ({ body, principal }) => reportCards.make(asStaff(principal), body.classId, body.term));
  route(app, 'GET /api/v1/report-cards', ({ query, principal }) => reportCards.list(asStaff(principal), query.classId, query.term));
  route(app, 'GET /api/v1/report-cards/terms', ({ query, principal }) => reportCards.terms(asStaff(principal), query.classId));
  route(app, 'PUT /api/v1/report-cards/:id/remarks', ({ params, body, principal }) => reportCards.setRemarks(asStaff(principal), params.id, body.remarks));
  route(app, 'PUT /api/v1/report-cards/:id/status', ({ params, body, principal }) => reportCards.setStatus(asStaff(principal), params.id, body.status));
}
