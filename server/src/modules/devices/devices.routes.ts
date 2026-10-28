import type { FastifyInstance } from 'fastify';
import { asStaff, route } from '../../core/route.js';
import type { DeviceEnrolmentService } from './device-enrolment.service.js';

export function deviceRoutes(app: FastifyInstance, deps: { enrolment: DeviceEnrolmentService }) {
  const { enrolment } = deps;
  route(app, 'POST /api/v1/devices/enrol-window', ({ body, principal }) => enrolment.openWindow(asStaff(principal), body.minutes));
  route(app, 'DELETE /api/v1/devices/enrol-window', () => enrolment.closeWindow());
  route(app, 'GET /api/v1/devices', () => enrolment.list());
  route(app, 'POST /api/v1/auth/device/enrol', ({ body, req }) => enrolment.enrol(body, req.ip));
}
