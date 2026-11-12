import type { FastifyInstance } from 'fastify';
import { asStaff, route } from '../../core/route.js';
import type { AiService } from './ai.service.js';

export function aiRoutes(app: FastifyInstance, deps: { ai: AiService }) {
  const { ai } = deps;
  route(app, 'GET /api/v1/ai/status', () => ai.status());
  route(app, 'POST /api/v1/ai/quiz', ({ body, query, principal }) => ai.requestQuiz(asStaff(principal), body, query.wait === '1'));
  route(app, 'POST /api/v1/ai/ask', ({ body, query, principal }) => ai.requestAsk(asStaff(principal), body, query.wait === '1'));
  route(app, 'GET /api/v1/ai/jobs', ({ principal }) => ai.jobs(asStaff(principal)));
  route(app, 'GET /api/v1/ai/jobs/:id', ({ params, principal }) => ai.job(asStaff(principal), params.id));
}
