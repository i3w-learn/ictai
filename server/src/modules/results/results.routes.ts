import type { FastifyInstance } from 'fastify';
import { asStaff, asStudent, route } from '../../core/route.js';
import { scopeOf } from '../../core/scope.js';
import type { ProgressService } from './progress.service.js';
import type { ResultsService } from './results.service.js';

export function resultRoutes(app: FastifyInstance, deps: { results: ResultsService; progress: ProgressService }) {
  const { results, progress } = deps;
  route(app, 'GET /api/v1/me/progress', ({ principal }) => progress.mine(asStudent(principal)));
  route(app, 'GET /api/v1/results/overview', ({ query, principal }) => results.overview(scopeOf(asStaff(principal)), query.classId));
  route(app, 'GET /api/v1/results/students/:id', ({ params, principal }) => results.student(scopeOf(asStaff(principal)), params.id));
  route(app, 'GET /api/v1/results/teachers', () => results.teachers());
}
