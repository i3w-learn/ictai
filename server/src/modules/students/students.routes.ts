import type { FastifyInstance } from 'fastify';
import { asDevice, route } from '../../core/route.js';
import type { StudentAdminService } from './student-admin.service.js';
import type { StudentAuthService } from './student-auth.service.js';

export function studentRoutes(app: FastifyInstance, deps: { admin: StudentAdminService; auth: StudentAuthService }) {
  const { admin, auth } = deps;

  // Staff: classes, sections, students
  route(app, 'GET /api/v1/classes', () => admin.listClasses());
  route(app, 'POST /api/v1/classes', ({ body }) => admin.addClass(body.name));
  route(app, 'POST /api/v1/sections', ({ body }) => admin.addSection(body.classId, body.name));
  route(app, 'GET /api/v1/students', ({ query }) => admin.listStudents(query.classId));
  route(app, 'POST /api/v1/students', ({ body }) => admin.addStudent(body));
  route(app, 'PUT /api/v1/students/:id/pin', ({ params, body }) => admin.resetPin(params.id, body.pin));
  route(app, 'POST /api/v1/students/:id/enrolment-code', ({ params }) => admin.issueEnrolmentCode(params.id));

  // Lab PC: student sign-in
  route(app, 'GET /api/v1/auth/student/classes', () => auth.listClasses());
  route(app, 'GET /api/v1/auth/student/roster', ({ query }) => auth.roster(query.classId));
  route(app, 'POST /api/v1/auth/student/pin', ({ body, principal }) => auth.withPin(asDevice(principal), body.studentId, body.pin));
  route(app, 'POST /api/v1/auth/student/qr', ({ body, principal }) => auth.withQr(asDevice(principal), body.qrToken));
  route(app, 'POST /api/v1/auth/student/enrol', ({ body, principal }) => auth.firstSignIn(asDevice(principal), body.code, body.pin));
}
