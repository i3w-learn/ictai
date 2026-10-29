import type { FastifyInstance } from 'fastify';
import { asStaff, route } from '../../core/route.js';
import type { StaffAdminService } from './staff-admin.service.js';

export function staffRoutes(app: FastifyInstance, deps: { admin: StaffAdminService }) {
  const { admin } = deps;

  route(app, 'GET /api/v1/staff', () => admin.list());
  route(app, 'POST /api/v1/staff', ({ body, principal }) => admin.addTeacher(asStaff(principal), body));
  route(app, 'PATCH /api/v1/staff/:id', ({ params, body, principal }) => admin.updateTeacher(asStaff(principal), params.id, body));
  route(app, 'PUT /api/v1/staff/:id/password', ({ params, body, principal }) => admin.setPassword(asStaff(principal), params.id, body.password));
  route(app, 'DELETE /api/v1/staff/:id', ({ params, principal }) => admin.remove(asStaff(principal), params.id));
}
