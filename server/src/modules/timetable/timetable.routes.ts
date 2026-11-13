import type { FastifyInstance } from 'fastify';
import { asStaff, asStudent, route } from '../../core/route.js';
import type { TimetableService } from './timetable.service.js';

export function timetableRoutes(app: FastifyInstance, deps: { timetable: TimetableService }) {
  const { timetable } = deps;
  route(app, 'GET /api/v1/timetable', () => timetable.get());
  route(app, 'PUT /api/v1/timetable/slot', ({ body, principal }) => timetable.set(asStaff(principal), body));
  route(app, 'DELETE /api/v1/timetable/slot', ({ query, principal }) => timetable.clear(asStaff(principal), query.day, query.periodId));
  route(app, 'GET /api/v1/timetable/today', ({ principal }) => timetable.today(asStudent(principal)));
}
