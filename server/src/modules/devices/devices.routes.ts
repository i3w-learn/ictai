import type { FastifyInstance } from 'fastify';
import { asStaff, route } from '../../core/route.js';
import { scopeOf } from '../../core/scope.js';
import type { DeviceEnrolmentService } from './device-enrolment.service.js';
import type { ScreenLocks } from './screen-locks.js';

export function deviceRoutes(app: FastifyInstance, deps: { enrolment: DeviceEnrolmentService; locks: ScreenLocks }) {
  const { enrolment, locks } = deps;
  route(app, 'GET /api/v1/devices/joining', () => enrolment.joining());
  route(app, 'PUT /api/v1/devices/joining', ({ body, principal }) => enrolment.setJoining(asStaff(principal), body.open));
  route(app, 'PUT /api/v1/devices/lock', ({ body, principal }) => {
    const staff = asStaff(principal);
    locks.setAll(staff, body.locked);
    return enrolment.list(scopeOf(staff));
  });
  route(app, 'PUT /api/v1/devices/:id/lock', ({ params, body, principal }) => {
    const staff = asStaff(principal);
    locks.setOne(staff, params.id, body.locked);
    return enrolment.list(scopeOf(staff));
  });
  // The check that this is an enrolled device has already moved its "last seen" time; nothing more to do.
  route(app, 'POST /api/v1/devices/ping', () => undefined);
  route(app, 'DELETE /api/v1/devices/:id', ({ params, principal }) => enrolment.remove(asStaff(principal), params.id));
  route(app, 'GET /api/v1/devices', ({ principal }) => enrolment.list(scopeOf(asStaff(principal))));
  route(app, 'POST /api/v1/auth/device/enrol', ({ body, req }) => enrolment.enrol(body, req.ip));
}
