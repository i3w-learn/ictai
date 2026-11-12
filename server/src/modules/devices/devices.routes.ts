import type { FastifyInstance } from 'fastify';
import { asStaff, route } from '../../core/route.js';
import { scopeOf } from '../../core/scope.js';
import type { DeviceEnrolmentService } from './device-enrolment.service.js';

export function deviceRoutes(app: FastifyInstance, deps: { enrolment: DeviceEnrolmentService }) {
  const { enrolment } = deps;
  route(app, 'GET /api/v1/devices/joining', () => enrolment.joining());
  route(app, 'PUT /api/v1/devices/joining', ({ body, principal }) => enrolment.setJoining(asStaff(principal), body.open));
  // The check that this is an enrolled device has already moved its "last seen" time; nothing more to do.
  route(app, 'POST /api/v1/devices/ping', () => undefined);
  route(app, 'DELETE /api/v1/devices/:id', ({ params, principal }) => enrolment.remove(asStaff(principal), params.id));
  route(app, 'GET /api/v1/devices', ({ principal }) => enrolment.list(scopeOf(asStaff(principal))));
  route(app, 'POST /api/v1/auth/device/enrol', ({ body, req }) => enrolment.enrol(body, req.ip));
}
