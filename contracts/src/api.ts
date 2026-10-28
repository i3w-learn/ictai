import { z, type ZodType } from 'zod';
import { Health } from './common.js';
import { Principal, SessionResult, StaffLogin, StudentFirstLogin, StudentPinLogin, StudentQrLogin } from './auth.js';
import { Device, DeviceEnrol, DeviceEnrolResult, EnrolWindow, OpenEnrolWindow } from './devices.js';
import {
  ClassQuery, CreatedStudent, IdParams, NewClass, NewSection, NewStudent, RosterEntry,
  SchoolClass, Section, SetPin, Student, StudentEnrolmentCode,
} from './students.js';
import type { Permission } from './permissions.js';

// Who may call a route. The server enforces it; the OpenAPI file documents it.
export type Access =
  | { kind: 'public' }
  | { kind: 'signed-in' }
  | { kind: 'staff'; permission?: Permission }
  | { kind: 'device'; deviceKind?: 'lab_pc' | 'board' };

export interface Endpoint {
  summary: string;
  access: Access;
  body?: ZodType;
  query?: ZodType;
  params?: ZodType;
  status: number;
  response?: ZodType;
}

const pub: Access = { kind: 'public' };
const staff = (permission?: Permission): Access => ({ kind: 'staff', permission });
const labPc: Access = { kind: 'device', deviceKind: 'lab_pc' };

// The single list of REST endpoints. A contract test checks the server serves exactly these.
export const API = {
  'GET /health': { summary: 'Server identity, used by discovery', access: pub, status: 200, response: Health },

  'POST /api/v1/auth/staff': { summary: 'Staff sign-in', access: pub, body: StaffLogin, status: 201, response: SessionResult },
  'GET /api/v1/auth/me': { summary: 'Who is signed in', access: { kind: 'signed-in' }, status: 200, response: Principal },
  'POST /api/v1/auth/logout': { summary: 'End this session', access: { kind: 'signed-in' }, status: 204 },

  'GET /api/v1/auth/student/classes': { summary: 'Classes for the sign-in screen', access: labPc, status: 200, response: z.array(SchoolClass) },
  'GET /api/v1/auth/student/roster': { summary: 'Student names in a class', access: labPc, query: ClassQuery, status: 200, response: z.array(RosterEntry) },
  'POST /api/v1/auth/student/pin': { summary: 'Student sign-in with PIN', access: labPc, body: StudentPinLogin, status: 201, response: SessionResult },
  'POST /api/v1/auth/student/qr': { summary: 'Student sign-in with QR card', access: labPc, body: StudentQrLogin, status: 201, response: SessionResult },
  'POST /api/v1/auth/student/enrol': { summary: 'First sign-in with an enrolment code; sets the PIN', access: labPc, body: StudentFirstLogin, status: 201, response: SessionResult },

  'POST /api/v1/auth/device/enrol': { summary: 'Enrol a lab PC or board with the window code', access: pub, body: DeviceEnrol, status: 201, response: DeviceEnrolResult },
  'POST /api/v1/devices/enrol-window': { summary: 'Open a device enrol window', access: staff('setup.devices'), body: OpenEnrolWindow, status: 201, response: EnrolWindow },
  'DELETE /api/v1/devices/enrol-window': { summary: 'Close the enrol window', access: staff('setup.devices'), status: 204 },
  'GET /api/v1/devices': { summary: 'List devices', access: staff('setup.devices'), status: 200, response: z.array(Device) },

  'GET /api/v1/classes': { summary: 'List classes', access: staff(), status: 200, response: z.array(SchoolClass) },
  'POST /api/v1/classes': { summary: 'Add a class', access: staff('setup.master'), body: NewClass, status: 201, response: SchoolClass },
  'POST /api/v1/sections': { summary: 'Add a section', access: staff('setup.master'), body: NewSection, status: 201, response: Section },
  'GET /api/v1/students': { summary: 'Students in a class', access: staff('students.manage'), query: ClassQuery, status: 200, response: z.array(Student) },
  'POST /api/v1/students': { summary: 'Add a student', access: staff('students.manage'), body: NewStudent, status: 201, response: CreatedStudent },
  'PUT /api/v1/students/:id/pin': { summary: 'Reset a student PIN', access: staff('students.manage'), params: IdParams, body: SetPin, status: 204 },
  'POST /api/v1/students/:id/enrolment-code': { summary: 'One-time first sign-in code', access: staff('students.manage'), params: IdParams, status: 201, response: StudentEnrolmentCode },
} as const satisfies Record<string, Endpoint>;

export type RouteKey = keyof typeof API;
