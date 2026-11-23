import type { FastifyInstance } from 'fastify';
import { asStaff, route } from '../../core/route.js';
import type { AttendanceService } from './attendance.service.js';

export function attendanceRoutes(app: FastifyInstance, deps: { attendance: AttendanceService }) {
  const { attendance } = deps;
  route(app, 'GET /api/v1/attendance', ({ query, principal }) => attendance.day(asStaff(principal), query.classId, query.date));
  route(app, 'PUT /api/v1/attendance/:id', ({ params, body, principal }) => attendance.mark(asStaff(principal), params.id, body));
}
