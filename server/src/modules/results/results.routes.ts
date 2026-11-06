import type { FastifyInstance } from 'fastify';
import { asStaff, route } from '../../core/route.js';
import { scopeOf } from '../../core/scope.js';
import type { ResultsService } from './results.service.js';

export function resultRoutes(app: FastifyInstance, deps: { results: ResultsService }) {
  const { results } = deps;
  route(app, 'GET /api/v1/results/overview', ({ query, principal }) => results.overview(scopeOf(asStaff(principal)), query.classId));
  route(app, 'GET /api/v1/results/students/:id', ({ params, principal }) => results.student(scopeOf(asStaff(principal)), params.id));
  route(app, 'GET /api/v1/results/teachers', () => results.teachers());
}
