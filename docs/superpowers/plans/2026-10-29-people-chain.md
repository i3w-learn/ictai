# People Chain Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the Super Admin → Teacher → Student chain: the Super Admin manages teacher accounts, and teachers fully manage students and sections from the console.

**Architecture:** Same shape as the existing modules: contract rows in `contracts/src/api.ts`, then `*.repository` (SQL) → `*.service` (rules) → `*.routes` (HTTP via `route()`), wired in `server/src/container.ts`. No new tables: `users` and `students` already have every column needed. Deletes are soft (`status = 'deleted'`). The console gets a new `StaffPanel` and an extended `StudentsPanel`.

**Tech Stack:** Node 22, Fastify, better-sqlite3, zod contracts, vitest; Tauri 2 + React client.

**Spec:** `docs/ict-app-final-spec.md` — Section 3 (roles, sign-in, permissions) and Section 4.1 row "Staff (Super Admin)" (line 147).

## Global Constraints

- Spec 4.1: "Add, edit, delete teachers; reset password; switch 'can host lessons' and 'can upload content'" — Super Admin only (`staff.manage`).
- Spec 3 / line 103: Super Admin accounts come from the installer now and the signed field-person list in M4. **These routes create and edit teachers only, never Super Admins.**
- Spec 3: permissions and account status are re-read on every request (already true in `PrincipalResolver`); disabling or deleting must take effect on the next request.
- Staff password: min 8, max 200 chars (matches `BootstrapAdmin` in `server/src/modules/auth/bootstrap-admin.ts`).
- Student PIN: the existing `Pin` schema (4 digits).
- Never return password or PIN hashes in any response.
- Every new route goes in the `API` table; `server/test/contract.test.ts` must stay green (it checks served routes == table, and that protected routes return 401 with no token).
- Run `pnpm --filter @ict/contracts openapi` after contract changes and commit `contracts/openapi.json`.

## Review Focus

1. A teacher who is disabled or deleted while signed in → their next request gets 401. (Task 2 test `ends a disabled teacher's session at once`.)
2. A teacher's password is reset → their old session stops working. (Task 2 test `password reset ends old sessions`.)
3. A deleted student who is signed in on a lab PC → next request 401, and they vanish from the lab PC roster. (Task 3 test `deleting a student ends their session and hides them`.)
4. Someone tries to edit, reset or delete a Super Admin through the staff routes → 403. (Task 2 test `cannot touch a super admin`.)
5. Adding `Priya` when `priya` exists → 409 (username is `COLLATE NOCASE`). (Task 2 test `rejects a duplicate username in any case`.)

---

### Task 1: Staff contracts

**Files:**
- Create: `contracts/src/staff.ts`
- Modify: `contracts/src/index.ts`, `contracts/src/api.ts`, `contracts/src/students.ts`
- Regenerate: `contracts/openapi.json`

**Interfaces:**
- Produces (in `contracts/src/staff.ts`):
  - `StaffMember = { id, username, displayName, role: StaffRole, canHostLessons: boolean, canUploadContent: boolean, status: 'active' | 'disabled' }`
  - `NewTeacher = { username: string(trim, 1–64), displayName: string(trim, 1–80), password: string(8–200) }`
  - `UpdateTeacher = { displayName?, canHostLessons?, canUploadContent?, status?: 'active' | 'disabled' }` — at least one field (`.refine`)
  - `SetPassword = { password: string(8–200) }`
- Produces (in `contracts/src/students.ts`):
  - `UpdateStudent = { name?, sectionId?: Id | null, rollNo?: string | null }` — same limits as `NewStudent`, at least one field
- Produces (new `API` rows):

| Key | access | body / query / params | status | response |
|---|---|---|---|---|
| `GET /api/v1/staff` | `staff('staff.manage')` | — | 200 | `z.array(StaffMember)` |
| `POST /api/v1/staff` | `staff('staff.manage')` | body `NewTeacher` | 201 | `StaffMember` |
| `PATCH /api/v1/staff/:id` | `staff('staff.manage')` | params `IdParams`, body `UpdateTeacher` | 200 | `StaffMember` |
| `PUT /api/v1/staff/:id/password` | `staff('staff.manage')` | params `IdParams`, body `SetPassword` | 204 | — |
| `DELETE /api/v1/staff/:id` | `staff('staff.manage')` | params `IdParams` | 204 | — |
| `GET /api/v1/sections` | `staff()` | query `ClassQuery` | 200 | `z.array(Section)` |
| `PATCH /api/v1/students/:id` | `staff('students.manage')` | params `IdParams`, body `UpdateStudent` | 200 | `Student` |
| `DELETE /api/v1/students/:id` | `staff('students.manage')` | params `IdParams` | 204 | — |

- [ ] **Step 1:** Add the schemas and the eight rows above. Export `staff.ts` from `contracts/src/index.ts`.
- [ ] **Step 2:** Run `pnpm --filter @ict/server test -- contract`. Expected: FAIL — `server routes match the contract table` lists the eight new keys as missing. (This failing test is the test for Task 1; Tasks 2–3 make it pass.)
- [ ] **Step 3:** Run `pnpm --filter @ict/contracts openapi`. Expected: `contracts/openapi.json` gains the eight operations.
- [ ] **Step 4: Commit** — `git add contracts && git commit -m "contracts: staff management, student edit/delete, list sections"`

---

### Task 2: Staff management on the server

**Files:**
- Create: `server/src/modules/staff/staff-admin.service.ts`, `server/src/modules/staff/staff.routes.ts`, `server/test/staff.test.ts`
- Modify: `server/src/modules/auth/staff.repository.ts`, `server/src/modules/auth/session.repository.ts`, `server/src/container.ts`, `server/src/app.ts`

**Interfaces:**
- Consumes: Task 1 schemas and API rows.
- Produces:
  - `StaffRepository.list(): StaffRow[]` — `status != 'deleted'`, ordered by `display_name`
  - `StaffRepository.insertTeacher(u: { username, displayName, passwordHash, now }): StaffRow` — plain INSERT (not the upsert), role `'teacher'`
  - `StaffRepository.update(id, fields: { displayName?, canHostLessons?, canUploadContent?, status?, passwordHash? }, now): void`
  - `SessionRepository.deleteForUser(kind: SessionKind, userId: string): void`
  - `StaffAdminService` (constructor: `now, staff: StaffRepository, sessions: SessionRepository, audit: AuditLog`):
    - `list(): StaffMember[]`
    - `addTeacher(actor: StaffPrincipal, t: NewTeacher): Promise<StaffMember>` — 409 `ALREADY_EXISTS` on unique clash
    - `updateTeacher(actor, id, u: UpdateTeacher): StaffMember`
    - `setPassword(actor, id, password): Promise<void>` — also calls `sessions.deleteForUser('staff', id)`
    - `remove(actor, id): void` — sets `status = 'deleted'`, calls `sessions.deleteForUser('staff', id)`
    - Every mutating method: 404 `notFound('Teacher')` if missing or deleted; 403 `forbidden('Super Admin accounts are managed by the field team.')` if the target's role is `super_admin`; writes an audit row (`staff.add`, `staff.update`, `staff.password`, `staff.delete`, target = user id).
  - `staffRoutes(app, { admin: StaffAdminService })` registered in `buildApp`; container key `staffAdmin`.
- Move the existing `unique()` helper from `student-admin.service.ts` to `server/src/core/errors.ts` as `export function unique<T>(insert: () => T, message: string): T` and use it from both services.

- [ ] **Step 1: Write the failing tests** in `server/test/staff.test.ts` (use `testServer()`; `admin` is Super Admin, `teacher` is a teacher):
  - `adds a teacher who can then sign in` — POST `/api/v1/staff` `{ username: 'priya', displayName: 'Priya S', password: 'priya-pass' }` → 201, body has `role: 'teacher'`, `canHostLessons: true`, no key matching `/hash/`; `login('priya', 'priya-pass')` returns a token.
  - `rejects a duplicate username in any case` — add `priya`, then `Priya` → 409 `ALREADY_EXISTS`.
  - `a teacher cannot manage staff` — `teacher` token on `GET /api/v1/staff` → 403.
  - `switches apply on the next request` — PATCH `{ canHostLessons: false }` → priya's `/auth/me` permissions lack `lesson.start`.
  - `ends a disabled teacher's session at once` — priya signs in; PATCH `{ status: 'disabled' }`; priya's `/auth/me` → 401; `login` again → 401.
  - `password reset ends old sessions` — priya signs in; PUT `/password` `{ password: 'new-pass-123' }` → 204; old token → 401; new password signs in.
  - `deletes a teacher` — DELETE → 204; not in `GET /api/v1/staff`; priya's old token → 401.
  - `cannot touch a super admin` — find `admin`'s id from `GET /api/v1/staff`; PATCH, PUT `/password`, DELETE each → 403.
  - `rejects a short password` — POST with `password: 'short'` → 400.
- [ ] **Step 2:** Run `pnpm --filter @ict/server test -- staff`. Expected: FAIL (404s — routes not registered).
- [ ] **Step 3:** Implement the repository methods, `StaffAdminService`, `staffRoutes`, and wire them. Map rows to `StaffMember` in one `toStaffMember` function next to the repository.
- [ ] **Step 4:** Run `pnpm --filter @ict/server test`. Expected: `staff.test.ts` passes; `contract.test.ts` still lists only the three student/section keys as missing.
- [ ] **Step 5: Commit** — `git commit -m "server: Super Admin manages teacher accounts"`

---

### Task 3: Student edit, delete and section list on the server

**Files:**
- Modify: `server/src/modules/students/student.repository.ts`, `server/src/modules/students/class.repository.ts`, `server/src/modules/students/student-admin.service.ts`, `server/src/modules/students/students.routes.ts`, `server/src/container.ts`
- Test: `server/test/students.test.ts`

**Interfaces:**
- Consumes: Task 1 rows; `SessionRepository.deleteForUser` and `unique` from Task 2.
- Produces:
  - `ClassRepository.listSections(classId): Section[]` ordered by name
  - `StudentRepository.update(id, fields: { name?, sectionId?, rollNo? }, now): void`
  - `StudentRepository.markDeleted(id, now): void` — also clears `enrol_code_hash` so a pending first sign-in code dies
  - `StudentAdminService` gains `listSections(classId)`, `updateStudent(id, u: UpdateStudent): Student`, `removeStudent(id): void`. Constructor gains `sessions: SessionRepository`.
  - `updateStudent` with a `sectionId` that is not in the student's class → 404 `notFound('Section in this class')`.
  - `removeStudent` calls `sessions.deleteForUser('student', id)`.

- [ ] **Step 1: Write the failing tests** in `server/test/students.test.ts` (reuse `withStudent()`):
  - `lists sections for a class` — GET `/api/v1/sections?classId=` → `[{ name: 'A', classId }]`.
  - `edits a student` — PATCH `{ name: 'Asha V', rollNo: '13' }` → 200 with those values; roster shows `Asha V`.
  - `rejects a section from another class` — add class `8` with section `B`; PATCH student `{ sectionId: <B> }` → 404.
  - `deleting a student ends their session and hides them` — student signs in on the lab PC (existing PIN flow, PIN `4321`); DELETE → 204; student's `/auth/me` → 401; roster no longer has them; their first sign-in code (issue one before deleting) → 401 on `/auth/student/enrol`.
- [ ] **Step 2:** Run `pnpm --filter @ict/server test -- students`. Expected: the four new tests FAIL.
- [ ] **Step 3:** Implement and register the three routes.
- [ ] **Step 4:** Run `pnpm test` from the repo root. Expected: everything passes, including `contract.test.ts`.
- [ ] **Step 5: Commit** — `git commit -m "server: edit and delete students, list sections"`

---

### Task 4: Staff panel in the console

**Files:**
- Create: `apps/client/src/features/home/StaffPanel.tsx`
- Modify: `apps/client/src/features/home/Home.tsx`

**Interfaces:**
- Consumes: `call()` from `useApp()`; Task 1 routes; `Panel`, `Field`, `Button`, `ErrorNote`, `Note`, `useAction` from `ui/ui.tsx`.
- Produces: `export function StaffPanel()`; `Home.tsx` renders it first when `p.permissions.includes('staff.manage')`.

Panel content, following `StudentsPanel`'s layout and idiom:
- Add-teacher form: Username, Name, Starting password (`type="password"`); button disabled until password ≥ 8.
- One row per account: initial badge, name, `@username`, a "Super Admin" tag for that role. Teacher rows only: two toggles ("Can host lessons", "Can upload content") that PATCH immediately; "Disable"/"Enable"; "Reset password" (inline field + Save); "Delete".
- Delete uses an inline "Delete Priya? Yes / No" confirm in the row — **no `window.confirm`** (browser dialogs block the Tauri webview automation).

- [ ] **Step 1:** Build the panel.
- [ ] **Step 2:** Run `pnpm typecheck`. Expected: no errors.
- [ ] **Step 3: Verify by hand** — `just reset-server && just server`, `just app`, sign in as `admin / admin123`. Add `priya`; sign out; sign in as `priya` → no Staff panel shown. Sign back in as admin; switch "Can host lessons" off; disable Priya → Priya can't sign in.
- [ ] **Step 4: Commit** — `git commit -m "console: Staff panel for the Super Admin"`

---

### Task 5: Full student management in the console

**Files:**
- Create: `apps/client/src/features/home/StudentRow.tsx`
- Modify: `apps/client/src/features/home/StudentsPanel.tsx`

**Interfaces:**
- Consumes: Task 1 routes (`GET /api/v1/sections`, `POST /api/v1/sections`, `PATCH|DELETE /api/v1/students/:id`, existing `PUT /api/v1/students/:id/pin`).
- Produces: `export function StudentRow({ student, sections, onChanged }: { student: Student; sections: Section[]; onChanged: () => Promise<void> })` — one student's line with its own actions, so `StudentsPanel` stays a list.

Changes:
- `StudentsPanel`: load sections when the class changes; "Add section" field next to "Add class"; the add-student form gains Section (select, optional) and Roll no. Remove the "Just enough student setup (M1)" comment.
- `StudentRow`: shows roll no and section; "Edit" (inline name / roll no / section, Save / Cancel); "Reset PIN" (inline 4-digit field, Save); existing "First sign-in code"; "Delete" with the same inline confirm as Task 4.

- [ ] **Step 1:** Build it.
- [ ] **Step 2:** Run `pnpm typecheck` and `pnpm test`. Expected: all pass.
- [ ] **Step 3: Verify by hand** — as a teacher: add section `A`, add a student with section and roll no, edit the name, reset the PIN, then sign that student in on a second app window set to Student PC with the new PIN. Delete the student → they are gone from the lab PC's name list.
- [ ] **Step 4: Commit** — `git commit -m "console: edit, delete, reset PIN and sections for students"`
