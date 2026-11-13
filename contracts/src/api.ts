import { z, type ZodType } from 'zod';
import { AuditEntry, AuditQuery, Health } from './common.js';
import { Principal, SessionResult, StaffLogin, StudentFirstLogin, StudentPinLogin, StudentQrLogin, StudentRollLogin } from './auth.js';
import { Device, DeviceEnrol, DeviceEnrolResult, Joining } from './devices.js';
import {
  ClassCode, ClassQuery, CreatedStudent, ImportResult, ImportStudents, PromoteClass, PromoteResult, SignInCard, IdParams, NewClass, NewSection, NewStudent, RosterEntry,
  SchoolClass, Section, SetPin, Student, StudentEnrolmentCode, UpdateStudent,
} from './students.js';
import {
  AnswerResult, OpenRun, OpenRunForStudent, Quiz, QuizInput, QuizQuery, QuizSummary, RunQuery, RunSummary,
  StudentRunState, SubmitAnswer, TeacherRunState,
} from './quizzes.js';
import { AiAskJob, AiAskRequest, AiJob, AiJobsQuery, AiQuizJob, AiQuizRequest, AiStatus, AiTutorJob, AiTutorRequest, AiWaitQuery, MyTutor } from './ai.js';
import { ResultsOverview, ResultsQuery, StudentResults, TeacherActivity, MyProgress } from './results.js';
import { Note, NoteInput } from './notes.js';
import { Notice, NoticeInput } from './notices.js';
import { SchoolSettings, StudentPrefs } from './settings.js';
import { SlotInput, SlotQuery, StudentToday, Timetable } from './timetable.js';
import { ContentItem, ContentQuery, FileChunk, FileChunkParams, FinishUpload, LinkInput, StartUpload, UploadChunk, UploadTicket } from './content.js';
import { Sequence, SequenceInput, Todo } from './sequences.js';
import { CardRemarks, CardStatusChange, CardsQuery, MakeCards, MakeCardsResult, ReportCard } from './report-cards.js';
import { Assignment, AssignmentDetail, AssignmentInput, MarkInput, MarkParams, MyWork, WorkAnswer } from './work.js';
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
  'GET /api/v1/auth/student/sections': { summary: 'Sections of a class, for the sign-in screen', access: labPc, query: ClassQuery, status: 200, response: z.array(Section) },
  'POST /api/v1/auth/student/roll': { summary: 'Student sign-in with class and roll number; adds the student the first time', access: labPc, body: StudentRollLogin, status: 201, response: SessionResult },
  'POST /api/v1/auth/student/pin': { summary: 'Student sign-in with PIN', access: labPc, body: StudentPinLogin, status: 201, response: SessionResult },
  'POST /api/v1/auth/student/qr': { summary: 'Student sign-in with QR card', access: labPc, body: StudentQrLogin, status: 201, response: SessionResult },
  'POST /api/v1/auth/student/enrol': { summary: 'First sign-in with an enrolment code; sets the PIN', access: labPc, body: StudentFirstLogin, status: 201, response: SessionResult },

  'POST /api/v1/auth/device/enrol': { summary: 'A lab PC or board joins the lab by itself, unless staff have locked the lab', access: pub, body: DeviceEnrol, status: 201, response: DeviceEnrolResult },
  'GET /api/v1/devices/joining': { summary: 'Whether new PCs and boards can still join', access: staff('setup.devices'), status: 200, response: Joining },
  'PUT /api/v1/devices/joining': { summary: 'Lock the lab against new devices, or open it again', access: staff('setup.devices'), body: Joining, status: 200, response: Joining },
  'POST /api/v1/devices/ping': { summary: 'A lab PC or board says it is switched on and reachable', access: { kind: 'device' }, status: 204 },
  'DELETE /api/v1/devices/:id': { summary: 'Remove a PC or board from the lab; it is signed out and must join again', access: staff('setup.devices'), params: IdParams, status: 204 },
  'GET /api/v1/devices': { summary: 'Devices, whether each is connected, and who is signed in on it', access: staff('setup.devices'), status: 200, response: z.array(Device) },

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
  'POST /api/v1/classes/:id/students/import': { summary: 'Add many students from a spreadsheet file', access: staff('students.manage'), params: IdParams, body: ImportStudents, status: 200, response: ImportResult },
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

  'POST /api/v1/quiz-runs': { summary: 'Open a Lab Mode run; the students of that class see it on their screens', access: staff('lesson.start'), body: OpenRun, status: 201, response: TeacherRunState },
  'GET /api/v1/quiz-runs': { summary: 'Runs of a quiz, newest first', access: staff(), query: RunQuery, status: 200, response: z.array(RunSummary) },
  'GET /api/v1/quiz-runs/:id': { summary: 'Live view of a run for the teacher', access: staff(), params: IdParams, status: 200, response: TeacherRunState },
  'POST /api/v1/quiz-runs/:id/start': { summary: 'Let joined students start answering', access: staff('lesson.control'), params: IdParams, status: 200, response: TeacherRunState },
  'POST /api/v1/quiz-runs/:id/end': { summary: 'End the run; nobody can join or answer any more', access: staff('lesson.control'), params: IdParams, status: 200, response: TeacherRunState },
  'GET /api/v1/quiz-runs/open': { summary: "Quizzes open for the student's class that they have not handed in", access: student, status: 200, response: z.array(OpenRunForStudent) },
  'POST /api/v1/quiz-runs/:id/join': { summary: "Student joins a run opened for their class", access: student, params: IdParams, status: 200, response: StudentRunState },
  'GET /api/v1/quiz-runs/:id/play': { summary: "The student's view of a run", access: student, params: IdParams, status: 200, response: StudentRunState },
  'POST /api/v1/quiz-runs/:id/answers': { summary: 'Answer one question; the first answer counts', access: student, params: IdParams, body: SubmitAnswer, status: 200, response: AnswerResult },
  'POST /api/v1/quiz-runs/:id/finish': { summary: 'Student is done; returns their score', access: student, params: IdParams, status: 200, response: StudentRunState },

  'GET /api/v1/ai/status': { summary: 'Is the AI installed and ready, and how many requests wait', access: staff('ai.teacher'), status: 200, response: AiStatus },
  'POST /api/v1/ai/quiz': { summary: 'Ask the AI for a draft quiz; returns the queued job, or with ?wait=1 the finished job with the questions', access: staff('ai.teacher'), query: AiWaitQuery, body: AiQuizRequest, status: 202, response: AiQuizJob },
  'POST /api/v1/ai/ask': { summary: 'Ask the AI a question; returns the queued job, or with ?wait=1 the finished job with the answer', access: staff('ai.teacher'), query: AiWaitQuery, body: AiAskRequest, status: 202, response: AiAskJob },
  'GET /api/v1/ai/tutor': { summary: "The student's own questions to the tutor, and how many are left today", access: student, status: 200, response: MyTutor },
  'POST /api/v1/ai/tutor': { summary: 'A student asks the tutor a question; returns the queued job', access: student, body: AiTutorRequest, status: 202, response: AiTutorJob },
  'GET /api/v1/ai/tutor/:id': { summary: "One of the student's own questions, with the answer when done", access: student, params: IdParams, status: 200, response: AiTutorJob },
  'GET /api/v1/ai/jobs': { summary: 'Your last 10 AI requests, newest first; ?kind= keeps to one kind', access: staff('ai.teacher'), query: AiJobsQuery, status: 200, response: z.array(AiJob) },
  'GET /api/v1/ai/jobs/:id': { summary: 'One of your AI requests, with the draft when done', access: staff('ai.teacher'), params: IdParams, status: 200, response: AiJob },

  // Settings: the school's own choices (Super Admin), and each student's screen choices.
  'GET /api/v1/settings': { summary: 'School name, AI switch and the periods of the day', access: staff(), status: 200, response: SchoolSettings },
  'PUT /api/v1/settings': { summary: 'Change the school settings', access: staff('settings.manage'), body: SchoolSettings, status: 200, response: SchoolSettings },
  'GET /api/v1/me/progress': { summary: "The student's own quiz results, work and what to try next", access: student, status: 200, response: MyProgress },
  'GET /api/v1/me/prefs': { summary: "The student's own text size, contrast and font", access: student, status: 200, response: StudentPrefs },
  'PUT /api/v1/me/prefs': { summary: "Save the student's own text size, contrast and font", access: student, body: StudentPrefs, status: 200, response: StudentPrefs },

  // Timetable: which class has the lab in which period, Monday to Saturday.
  'GET /api/v1/timetable': { summary: 'The whole weekly lab grid with its periods', access: staff(), status: 200, response: Timetable },
  'PUT /api/v1/timetable/slot': { summary: 'Give a class the lab for one period of one day', access: staff('setup.timetable'), body: SlotInput, status: 200, response: Timetable },
  'DELETE /api/v1/timetable/slot': { summary: 'Free the lab for one period of one day', access: staff('setup.timetable'), query: SlotQuery, status: 200, response: Timetable },
  'GET /api/v1/timetable/today': { summary: "The student's own lab periods today", access: student, status: 200, response: StudentToday },

  // Content library: files and links filed by class, subject and chapter. Files move in small pieces.
  'GET /api/v1/content': { summary: 'The library, optionally for one class', access: staff(), query: ContentQuery, status: 200, response: z.array(ContentItem) },
  'GET /api/v1/content/mine': { summary: "The library of the student's own class (My books)", access: student, status: 200, response: z.array(ContentItem) },
  'POST /api/v1/content/links': { summary: 'Add a web link to the library', access: staff('setup.content'), body: LinkInput, status: 201, response: ContentItem },
  'POST /api/v1/content/uploads': { summary: 'Start sending a file; says how many pieces to send', access: staff('setup.content'), body: StartUpload, status: 201, response: UploadTicket },
  'PUT /api/v1/content/uploads/:id/chunks': { summary: 'Send the next piece of the file', access: staff('setup.content'), params: IdParams, body: UploadChunk, status: 204 },
  'POST /api/v1/content/uploads/:id/finish': { summary: 'All pieces sent: check the file and file it in the library', access: staff('setup.content'), params: IdParams, body: FinishUpload, status: 201, response: ContentItem },
  'DELETE /api/v1/content/:id': { summary: 'Remove a library item; its file goes when nothing else uses it', access: staff('setup.content'), params: IdParams, status: 204 },
  'GET /api/v1/files/:hash/chunks/:index': { summary: 'One piece of a library file, for someone who may open it', access: { kind: 'signed-in' }, params: FileChunkParams, status: 200, response: FileChunk },

  // Playlists and learning paths (staff), and the student's "Things to do".
  'GET /api/v1/sequences': { summary: 'Playlists and learning paths you may see, newest first', access: staff('teaching.manage'), status: 200, response: z.array(Sequence) },
  'POST /api/v1/sequences': { summary: 'Make a playlist or a learning path for a class', access: staff('teaching.manage'), body: SequenceInput, status: 201, response: Sequence },
  'DELETE /api/v1/sequences/:id': { summary: 'Remove a playlist or learning path', access: staff('teaching.manage'), params: IdParams, status: 204 },
  'GET /api/v1/todo': { summary: "The student's class's playlists and paths, with done ticks and the next step", access: student, status: 200, response: z.array(Todo) },
  'POST /api/v1/todo/steps/:id/done': { summary: 'The student opened a library step; it is ticked', access: student, params: IdParams, status: 204 },

  // Report cards: made from the marks, with remarks; draft -> published -> frozen.
  'POST /api/v1/report-cards/make': { summary: 'Make draft report cards for a class and term, and refresh the drafts that exist', access: staff('results.view'), body: MakeCards, status: 200, response: MakeCardsResult },
  'GET /api/v1/report-cards': { summary: 'Report cards of a class for one term, in roll order', access: staff('results.view'), query: CardsQuery, status: 200, response: z.array(ReportCard) },
  'GET /api/v1/report-cards/terms': { summary: 'Terms a class has report cards for, newest first', access: staff('results.view'), query: ClassQuery, status: 200, response: z.array(z.string()) },
  'PUT /api/v1/report-cards/:id/remarks': { summary: "Write the teacher's remarks; refused once frozen", access: staff('results.view'), params: IdParams, body: CardRemarks, status: 200, response: ReportCard },
  'PUT /api/v1/report-cards/:id/status': { summary: 'Publish, take back to draft, or (Super Admin only) freeze for good', access: staff('results.view'), params: IdParams, body: CardStatusChange, status: 200, response: ReportCard },

  // Work: a teacher sets written work for a class, students hand in, the teacher marks.
  'GET /api/v1/assignments': { summary: 'Work you set or may mark, newest first', access: staff('teaching.manage'), status: 200, response: z.array(Assignment) },
  'POST /api/v1/assignments': { summary: 'Set a piece of work for a class', access: staff('teaching.manage'), body: AssignmentInput, status: 201, response: Assignment },
  'GET /api/v1/assignments/:id': { summary: "One piece of work with every student's latest answer and mark", access: staff('teaching.manage'), params: IdParams, status: 200, response: AssignmentDetail },
  'DELETE /api/v1/assignments/:id': { summary: 'Take a piece of work away; students no longer see it', access: staff('teaching.manage'), params: IdParams, status: 204 },
  'PUT /api/v1/assignments/:id/marks/:studentId': { summary: "Give or change one student's marks and comment", access: staff('teaching.manage'), params: MarkParams, body: MarkInput, status: 200, response: AssignmentDetail },
  'GET /api/v1/work': { summary: "The student's own work: to do, handed in and marked", access: student, status: 200, response: z.array(MyWork) },
  'POST /api/v1/work/:id/answers': { summary: 'Hand in an answer; handing in again adds a new one', access: student, params: IdParams, body: WorkAnswer, status: 201, response: MyWork },

  // Notices: one-way messages from staff to the whole school, a class or a section.
  'GET /api/v1/notices': { summary: 'Notices you may manage, pinned first, then newest', access: staff('teaching.manage'), status: 200, response: z.array(Notice) },
  'POST /api/v1/notices': { summary: 'Put up a notice', access: staff('teaching.manage'), body: NoticeInput, status: 201, response: Notice },
  'PUT /api/v1/notices/:id': { summary: 'Change a notice', access: staff('teaching.manage'), params: IdParams, body: NoticeInput, status: 200, response: Notice },
  'DELETE /api/v1/notices/:id': { summary: 'Take a notice down for good', access: staff('teaching.manage'), params: IdParams, status: 204 },
  'GET /api/v1/notices/mine': { summary: "Notices for the student's school, class and section that have not expired", access: student, status: 200, response: z.array(Notice) },

  // My notes: a student's own notebook. Staff have no route to it.
  'GET /api/v1/notes': { summary: 'Your notes, most recently changed first', access: student, status: 200, response: z.array(Note) },
  'POST /api/v1/notes': { summary: 'Write a new note', access: student, body: NoteInput, status: 201, response: Note },
  'PUT /api/v1/notes/:id': { summary: 'Change one of your notes', access: student, params: IdParams, body: NoteInput, status: 200, response: Note },
  'DELETE /api/v1/notes/:id': { summary: 'Delete one of your notes for good', access: student, params: IdParams, status: 204 },

  // Results (spec 4.4)
  'GET /api/v1/results/overview': { summary: 'How each student is doing, optionally for one class', access: staff('results.view'), query: ResultsQuery, status: 200, response: ResultsOverview },
  'GET /api/v1/results/students/:id': { summary: "One student's grade, subjects and quiz history", access: staff('results.view'), params: IdParams, status: 200, response: StudentResults },
  'GET /api/v1/results/teachers': { summary: 'What each teacher has done', access: staff('staff.manage'), status: 200, response: z.array(TeacherActivity) },
  'GET /api/v1/audit': { summary: 'Activity log, newest first, 100 at a time', access: staff('server.manage'), query: AuditQuery, status: 200, response: z.array(AuditEntry) },
} as const satisfies Record<string, Endpoint>;

export type RouteKey = keyof typeof API;
