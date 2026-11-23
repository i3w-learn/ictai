import type { FastifyInstance } from 'fastify';
import { asStaff, asStudent, route } from '../../core/route.js';
import type { ActivityService } from './activity.service.js';

export function activityRoutes(app: FastifyInstance, deps: { activities: ActivityService }) {
  const { activities } = deps;
  route(app, 'POST /api/v1/activities/:id/results', ({ params, body, principal }) => activities.finished(asStudent(principal), params.id, body));
  route(app, 'GET /api/v1/activities/:id/results', ({ params, principal }) => activities.scores(asStaff(principal), params.id));
}
