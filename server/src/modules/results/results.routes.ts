import type { FastifyInstance } from 'fastify';
import { route } from '../../core/route.js';
import type { ResultsService } from './results.service.js';

export function resultRoutes(app: FastifyInstance, deps: { results: ResultsService }) {
  const { results } = deps;
  route(app, 'GET /api/v1/results/overview', ({ query }) => results.overview(query.classId));
  route(app, 'GET /api/v1/results/students/:id', ({ params }) => results.student(params.id));
  route(app, 'GET /api/v1/results/teachers', () => results.teachers());
}
