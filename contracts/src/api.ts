import { z, type ZodType } from 'zod';
import { AuditEntry, AuditQuery, Health } from './common.js';
import { Principal, SessionResult, StaffLogin, StudentFirstLogin, StudentPinLogin, StudentQrLogin } from './auth.js';
import { Device, DeviceEnrol, DeviceEnrolResult, EnrolWindow, OpenEnrolWindow } from './devices.js';
import {
  ClassCode, ClassQuery, CreatedStudent, PromoteClass, PromoteResult, SignInCard, IdParams, NewClass, NewSection, NewStudent, RosterEntry,
  SchoolClass, Section, SetPin, Student, StudentEnrolmentCode, UpdateStudent,
} from './students.js';
import {
  AnswerResult, JoinRun, OpenRun, Quiz, QuizInput, QuizQuery, QuizSummary, RunQuery, RunSummary,
  StudentRunState, SubmitAnswer, TeacherRunState,
} from './quizzes.js';
import { NewTeacher, SetPassword, StaffMember, UpdateTeacher } from './staff.js';
import type { Permission } from './permissions.js';

// Who may call a route. The server enforces it; the OpenAPI file documents it.
export type Access =
  | { kind: 'public' }
  | { kind: 'signed-in' }
  | { kind: 'student' }
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
const student: Access = { kind: 'student' };
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

  'GET /api/v1/staff': { summary: 'List staff accounts', access: staff('staff.manage'), status: 200, response: z.array(StaffMember) },
  'POST /api/v1/staff': { summary: 'Add a teacher', access: staff('staff.manage'), body: NewTeacher, status: 201, response: StaffMember },
  'PATCH /api/v1/staff/:id': { summary: 'Edit a teacher, switch permissions, disable or enable', access: staff('staff.manage'), params: IdParams, body: UpdateTeacher, status: 200, response: StaffMember },
  'PUT /api/v1/staff/:id/password': { summary: 'Reset a teacher password; ends their sessions', access: staff('staff.manage'), params: IdParams, body: SetPassword, status: 204 },
  'DELETE /api/v1/staff/:id': { summary: 'Delete a teacher', access: staff('staff.manage'), params: IdParams, status: 204 },

  'GET /api/v1/classes': { summary: 'List classes', access: staff(), status: 200, response: z.array(SchoolClass) },
  'POST /api/v1/classes': { summary: 'Add a class', access: staff('setup.master'), body: NewClass, status: 201, response: SchoolClass },
  'POST /api/v1/classes/:id/promote': { summary: 'Move every student to another class', access: staff('students.manage'), params: IdParams, body: PromoteClass, status: 200, response: PromoteResult },
  'POST /api/v1/classes/:id/enrolment-codes': { summary: 'First sign-in codes for every student in a class', access: staff('students.manage'), params: IdParams, status: 201, response: z.array(ClassCode) },
  'POST /api/v1/classes/:id/cards': { summary: 'Printable sign-in cards (new QR + first sign-in code) for a class', access: staff('students.manage'), params: IdParams, status: 201, response: z.array(SignInCard) },
  'POST /api/v1/sections': { summary: 'Add a section', access: staff('setup.master'), body: NewSection, status: 201, response: Section },
  'GET /api/v1/sections': { summary: 'Sections in a class', access: staff(), query: ClassQuery, status: 200, response: z.array(Section) },
  'GET /api/v1/students': { summary: 'Students in a class', access: staff('students.manage'), query: ClassQuery, status: 200, response: z.array(Student) },
  'POST /api/v1/students': { summary: 'Add a student', access: staff('students.manage'), body: NewStudent, status: 201, response: CreatedStudent },
  'PATCH /api/v1/students/:id': { summary: 'Edit a student', access: staff('students.manage'), params: IdParams, body: UpdateStudent, status: 200, response: Student },
  'DELETE /api/v1/students/:id': { summary: 'Delete a student; ends their session', access: staff('students.manage'), params: IdParams, status: 204 },
  'PUT /api/v1/students/:id/pin': { summary: 'Reset a student PIN', access: staff('students.manage'), params: IdParams, body: SetPin, status: 204 },
  'POST /api/v1/students/:id/enrolment-code': { summary: 'One-time first sign-in code', access: staff('students.manage'), params: IdParams, status: 201, response: StudentEnrolmentCode },

  'GET /api/v1/quizzes': { summary: 'List quizzes, optionally for one class', access: staff(), query: QuizQuery, status: 200, response: z.array(QuizSummary) },
  'POST /api/v1/quizzes': { summary: 'Write a new quiz', access: staff('teaching.manage'), body: QuizInput, status: 201, response: Quiz },
  'GET /api/v1/quizzes/:id': { summary: 'A quiz with its questions and answers', access: staff(), params: IdParams, status: 200, response: Quiz },
  'PUT /api/v1/quizzes/:id': { summary: 'Replace a quiz; refused while it is running', access: staff('teaching.manage'), params: IdParams, body: QuizInput, status: 200, response: Quiz },
  'DELETE /api/v1/quizzes/:id': { summary: 'Delete a quiz', access: staff('teaching.manage'), params: IdParams, status: 204 },

  'POST /api/v1/quiz-runs': { summary: 'Open a Lab Mode run with a 6-digit join code', access: staff('lesson.start'), body: OpenRun, status: 201, response: TeacherRunState },
  'GET /api/v1/quiz-runs': { summary: 'Runs of a quiz, newest first', access: staff(), query: RunQuery, status: 200, response: z.array(RunSummary) },
  'GET /api/v1/quiz-runs/:id': { summary: 'Live view of a run for the teacher', access: staff(), params: IdParams, status: 200, response: TeacherRunState },
  'POST /api/v1/quiz-runs/:id/start': { summary: 'Let joined students start answering', access: staff('lesson.control'), params: IdParams, status: 200, response: TeacherRunState },
  'POST /api/v1/quiz-runs/:id/end': { summary: 'End the run; the join code stops working', access: staff('lesson.control'), params: IdParams, status: 200, response: TeacherRunState },
  'POST /api/v1/quiz-runs/join': { summary: 'Student joins a run by its code', access: student, body: JoinRun, status: 200, response: StudentRunState },
  'GET /api/v1/quiz-runs/:id/play': { summary: "The student's view of a run", access: student, params: IdParams, status: 200, response: StudentRunState },
  'POST /api/v1/quiz-runs/:id/answers': { summary: 'Answer one question; the first answer counts', access: student, params: IdParams, body: SubmitAnswer, status: 200, response: AnswerResult },
  'POST /api/v1/quiz-runs/:id/finish': { summary: 'Student is done; returns their score', access: student, params: IdParams, status: 200, response: StudentRunState },

  'GET /api/v1/audit': { summary: 'Activity log, newest first, 100 at a time', access: staff('server.manage'), query: AuditQuery, status: 200, response: z.array(AuditEntry) },
} as const satisfies Record<string, Endpoint>;

export type RouteKey = keyof typeof API;
