import type { StaffPrincipal } from '@ict/contracts';
import { forbidden, notFound } from './errors.js';

// What a signed-in staff member may see: the classes and subjects the Super Admin gave them.
// null means everything (the Super Admin, or a teacher with nothing set).
export interface Scope {
  classIds: string[] | null;
  subjects: string[] | null;
}

// Staff only, on purpose: a student or a device never gets a scope. A route that hands the
// wrong kind of caller to a scoped service then fails to compile instead of seeing everything.
export const scopeOf = (p: StaffPrincipal): Scope => ({ classIds: p.classIds, subjects: p.subjects });

export const seesClass = (s: Scope, classId: string) => !s.classIds || s.classIds.includes(classId);

// Subjects match without caring about capitals, so "maths" is "Maths".
export const seesSubject = (s: Scope, subject: string | null) =>
  !s.subjects || (subject != null && s.subjects.some((x) => x.toLowerCase() === subject.trim().toLowerCase()));

// A quiz is visible when both its class and its subject are.
export const seesQuiz = (s: Scope, q: { classId: string; subject: string | null }) => seesClass(s, q.classId) && seesSubject(s, q.subject);

export function checkClass(s: Scope, classId: string) {
  if (!seesClass(s, classId)) throw forbidden('This class is not one of yours. Ask the Super Admin.');
}

export function checkSubject(s: Scope, subject: string | null) {
  if (!seesSubject(s, subject)) throw forbidden(`Pick one of your subjects: ${s.subjects!.join(', ')}.`);
}

// A teacher works only with quizzes for their own classes and subjects.
export function checkQuiz(s: Scope, q: { classId: string; subject: string | null }) {
  checkClass(s, q.classId);
  checkSubject(s, q.subject);
}

// A class id named in a request: first "does it exist" (404), then "is it yours" (403), in that
// order on every route, so the same unknown id never gets two different answers.
export function checkMyClass(classes: { classExists(id: string): boolean }, s: Scope, classId: string) {
  if (!classes.classExists(classId)) throw notFound('Class');
  checkClass(s, classId);
}
