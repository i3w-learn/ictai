# Results Dashboard, Reports and Student Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teachers and the Super Admin see how every student is doing in quizzes (class dashboard, Excel download, one page per student), and the Super Admin also sees what each teacher has done.

**Architecture:** A new server module `results` reads the existing Lab Mode tables (`quiz_runs`, `quiz_participants`, `quiz_answers`, `quizzes`, `students`, `users`, `audit_log`) with SQL. No new tables, no migration. Three read-only routes in the contract. The console gets a Results panel on the home page, a student page, and a Teachers panel for the Super Admin. The Excel download is a CSV built in the browser from the overview data.

**Tech Stack:** Node 22, Fastify, better-sqlite3, zod contracts (`@ict/contracts`), vitest; React + Tailwind in `apps/client`.

**Spec:** `docs/ict-app-final-spec.md` — sections 3 (`results.view`), 4.4 (Quiz results & marks, Student analytics, Reports), 14 (`/results/students/:id`). Behaviour ported from v2 `ICT-AI-v2/src/pages/Dashboard.jsx`, `Reports.jsx`, `StudentDetail.jsx`.

## Global Constraints

- Results stay in school: "Never in the analytics upload" (spec 4.4). No network calls outside the LAN server.
- Every route is declared in `contracts/src/api.ts` and served through `route()`; `contracts/openapi.json` is regenerated with `just openapi`.
- Access: overview and student page `staff('results.view')`; teachers panel `staff('staff.manage')` (Super Admin only). Students get 403.
- Teachers see all students (spec 3: "by default all teachers are equal"; no teacher-to-class link exists yet).
- Bands (from v2): average ≥ 60 → `great` "Doing great"; 30–59 → `growing` "Growing"; < 30 → `needs` "Needs you"; no attempts → `none` "Not started".
- Grades (from v2): ≥ 90 A+, ≥ 80 A, ≥ 70 B, ≥ 60 C, ≥ 50 D, else E.
- Plain short English in all UI copy. Deleted students (`status = 'deleted'`) never appear.
- Do not add a DB migration (the open AI branch already takes version 4).

## Review Focus

1. A quiz edited after it was run so its total marks shrank — percent must never go above 100 (clamp).
2. A student who joined a run but answered nothing — counts as an attempt scoring 0 once the run has ended.
3. A run still in lobby or active, and the student has not pressed Finish — not counted yet (no half-finished scores).
4. A quiz with no subject — grouped under "No subject", not dropped.
5. Hindi names and commas in names in the CSV — must open correctly in Excel (UTF-8 BOM, quoted fields).

---

## Definitions used by every task

An **attempt** = one row in `quiz_participants` where the run has `status = 'ended'` OR the participant has `finished_at` set. Its **score** = `SUM(quiz_answers.points)` (0 if none). Its **total** = the quiz's current total marks (sum of `marks` in `questions_json`). **percent** = `min(100, round(score * 100 / total))`. A student's **average** = mean of their attempt percents, rounded to a whole number; `null` when they have no attempts.

---

### Task 1: Contracts and pure rules

**Files:**
- Create: `contracts/src/results.ts`
- Modify: `contracts/src/index.ts` (export), `contracts/src/api.ts` (3 routes)
- Create: `server/src/modules/results/rules.ts`
- Test: `server/test/results-rules.test.ts`

**Interfaces:**
- Produces (contracts):
  - `Band = z.enum(['great','growing','needs','none'])`
  - `ResultsQuery = z.object({ classId: Id.optional() })`
  - `StudentResultRow = { id, name, rollNo: string|null, classId, className, sectionName: string|null, attempts: number, average: number|null, band: Band }`
  - `ResultsOverview = { classAverage: number|null, counts: { great, growing, needs, none: number }, students: StudentResultRow[] }` — students sorted `needs, growing, great, none`, then name.
  - `AttemptRow = { runId, quizTitle, subject: string|null, topic: string|null, at: number, score: number, totalMarks: number, percent: number }`
  - `SubjectRow = { subject: string, attempts: number, average: number, grade: string }` — "No subject" when null; sorted best average first.
  - `StudentResults = { student: { id, name, rollNo, className, sectionName }, attempts: number, average: number|null, grade: string|null, subjects: SubjectRow[], history: AttemptRow[] }` — history newest first.
  - `TeacherActivity = { id, displayName, username, role: StaffRole, quizzesMade: number, runsHeld: number, studentsReached: number, lastSignInAt: number|null }`
  - API rows:
    - `'GET /api/v1/results/overview'`: `staff('results.view')`, query `ResultsQuery`, 200, `ResultsOverview`
    - `'GET /api/v1/results/students/:id'`: `staff('results.view')`, params `IdParams`, 200, `StudentResults`
    - `'GET /api/v1/results/teachers'`: `staff('staff.manage')`, 200, `z.array(TeacherActivity)`
- Produces (server): `percentOf(score: number, total: number): number`, `bandOf(average: number|null): Band`, `gradeOf(percent: number): string`, `averageOf(percents: number[]): number|null` in `server/src/modules/results/rules.ts`.

- [ ] **Step 1: Write the failing test** `server/test/results-rules.test.ts`

```ts
expect(percentOf(3, 4)).toBe(75);
expect(percentOf(5, 4)).toBe(100);      // quiz shrank after the run
expect(percentOf(0, 0)).toBe(0);
expect(bandOf(60)).toBe('great'); expect(bandOf(59)).toBe('growing');
expect(bandOf(30)).toBe('growing'); expect(bandOf(29)).toBe('needs'); expect(bandOf(null)).toBe('none');
expect([90, 80, 70, 60, 50, 49].map(gradeOf)).toEqual(['A+', 'A', 'B', 'C', 'D', 'E']);
expect(averageOf([])).toBeNull(); expect(averageOf([50, 75])).toBe(63);
```

- [ ] **Step 2: Run** `pnpm --filter server exec vitest run test/results-rules.test.ts` — Expected: FAIL, module not found.
- [ ] **Step 3: Implement** `rules.ts` and `contracts/src/results.ts`; add the 3 API rows (contract test will fail until Task 3 serves them — that is expected and fixed there).
- [ ] **Step 4: Run** the rules test — Expected: PASS. Run `pnpm -r typecheck` (or `just check`) — Expected: clean.
- [ ] **Step 5: Commit** `feat(results): contracts and scoring rules`

### Task 2: Results repository

**Files:**
- Create: `server/src/modules/results/results.repository.ts`
- Test: `server/test/results-repository.test.ts`

**Interfaces:**
- Consumes: Task 1 rules and types.
- Produces: `class ResultsRepository(db: Db)` with
  - `attempts(filter: { classId?: string; studentId?: string }): { studentId: string; runId: string; quizTitle: string; subject: string|null; topic: string|null; at: number; score: number; totalMarks: number }[]` — `at` = `finished_at ?? run.ended_at`; `totalMarks` computed in JS from `questions_json`; only counted attempts (see Definitions); only non-deleted students.
  - `students(classId?: string): { id, name, rollNo, classId, className, sectionName }[]` — active only, ordered by class then name.
  - `student(id: string)`: same shape or `undefined` (deleted → `undefined`).
  - `teacherActivity(): TeacherActivity[]` — users with status != 'deleted'; `quizzesMade` = non-deleted quizzes `created_by`; `runsHeld` = `quiz_runs.opened_by`; `studentsReached` = distinct students in their runs' participants; `lastSignInAt` = max `audit_log.at` where `action = 'signin'` and `actor_id = user.id` (check how `signin` is logged in `server/src/modules/auth/staff-auth.service.ts` and use the matching column). Ordered by display name.

- [ ] **Step 1: Write failing tests** using `openDb(':memory:')` and direct SQL inserts (pattern: `server/test/ai-queue.test.ts` setup). Cases:
  - `counts an ended run where the student answered nothing as 0`
  - `does not count an open run until the student finishes`
  - `sums points per attempt and reports the quiz total`
  - `leaves out deleted students`
  - `teacherActivity counts quizzes, runs, distinct students and last sign-in` (insert 2 runs with the same student → `studentsReached` 1)
- [ ] **Step 2: Run** — Expected: FAIL, module not found.
- [ ] **Step 3: Implement** with prepared statements; one SQL for `attempts` grouping by `(run_id, student_id)` with `LEFT JOIN quiz_answers`.
- [ ] **Step 4: Run** — Expected: PASS.
- [ ] **Step 5: Commit** `feat(results): read quiz results from Lab Mode tables`

### Task 3: Service, routes and wiring

**Files:**
- Create: `server/src/modules/results/results.service.ts`, `server/src/modules/results/results.routes.ts`
- Modify: `server/src/container.ts` (repo + service `results`), `server/src/app.ts` (`resultRoutes(app, { results: c.results })`)
- Modify: `contracts/openapi.json` (via `just openapi`)
- Test: `server/test/results.test.ts`

**Interfaces:**
- Consumes: Task 2 repository, Task 1 rules.
- Produces: `class ResultsService(repo: ResultsRepository)` with `overview(classId?: string): ResultsOverview`, `student(id: string): StudentResults` (throws `notFound('Student')` when missing), `teachers(): TeacherActivity[]`. `classAverage` = mean of every attempt percent in scope (not mean of student averages), `null` when none.

- [ ] **Step 1: Write failing API tests** in `server/test/results.test.ts`, reusing the `withQuiz` style from `server/test/quizzes.test.ts` (class 7, Asha + a second Class 7 student Rohan, quiz worth 3 marks, play a run through `/quiz-runs` routes, end it):
  - `overview bands students and gives the class average` — Asha 3/3 (100, great), Rohan 0 answers (0, needs), a third student with no run (`none`); `counts` = `{great:1, growing:0, needs:1, none:1}`; `classAverage` 50; first row is Rohan (needs first).
  - `overview filters by class` — Class 8 student not in `?classId=c7`.
  - `student page shows grade, subjects and history` — Asha: `average 100`, `grade 'A+'`, `subjects[0].subject` = quiz subject (create quiz with `subject: 'Maths'`), `history[0].percent` 100.
  - `student page groups a quiz with no subject under "No subject"`.
  - `student page 404s for unknown or deleted students`.
  - `teachers list is Super Admin only` — teacher gets 403, admin gets a row for `teacher` with `quizzesMade 1, runsHeld 1, studentsReached 2`.
  - `students cannot read results` — student token → 403 on overview.
- [ ] **Step 2: Run** `pnpm --filter server exec vitest run test/results.test.ts` — Expected: FAIL (404 routes).
- [ ] **Step 3: Implement** service and routes; wire container and app; run `just openapi`.
- [ ] **Step 4: Run** `just test` — Expected: all pass, including `contract.test.ts`.
- [ ] **Step 5: Commit** `feat(results): overview, student page and teacher activity routes`

### Task 4: Console — Results panel and Excel download

**Files:**
- Create: `apps/client/src/features/results/ResultsPanel.tsx`, `apps/client/src/features/results/csv.ts`
- Test: `apps/client/src/features/results/csv.test.ts`
- Modify: `apps/client/src/features/home/Home.tsx` (show panel first when `results.view`; new view `{ kind: 'student'; studentId: string }`)

**Interfaces:**
- Consumes: `GET /api/v1/results/overview`, `GET /api/v1/classes` (existing) for the class picker.
- Produces: `toCsv(rows: StudentResultRow[]): string` — header `Name,Roll no,Class,Section,Quizzes taken,Average %,Group`, Group in plain words ("Doing great", "Growing", "Needs you", "Not started"), blank cell for null, fields with `,` `"` or newline quoted with `"` doubled, starts with `﻿`, lines joined with `\r\n`. `ResultsPanel({ onStudent: (id: string) => void })`.

- [ ] **Step 1: Write failing test** `csv.test.ts`: BOM first; `'Sharma, Asha'` quoted; Hindi name `'आशा'` unchanged; null average → empty cell; band `needs` → `Needs you`.
- [ ] **Step 2: Run** `pnpm --filter client exec vitest run src/features/results/csv.test.ts` — Expected: FAIL.
- [ ] **Step 3: Implement** `csv.ts`; then `ResultsPanel` (Panel title "How students are doing"): class `Select` ("All classes" + classes), four count tiles (Doing great / Growing / Needs you / Not started) with colour dots, "Class average N%" (or "No quizzes yet"), a "Needs you today" line of name chips (or "Everyone on track"), and a table (Name, Roll, Class, Quizzes, Average, Group) — each row clickable → `onStudent(id)`. "Download for Excel" button saves `results-<class or all>-<yyyy-mm-dd>.csv` via a Blob link. Bars, not a chart library. Follow `AuditPanel.tsx` for `useApp().call` + `useAction`.
- [ ] **Step 4: Run** test — PASS; `just check` — clean.
- [ ] **Step 5: Commit** `feat(results): dashboard panel with Excel download`

### Task 5: Console — Student page and Teachers panel

**Files:**
- Create: `apps/client/src/features/results/StudentResultsPage.tsx`, `apps/client/src/features/results/TeachersPanel.tsx`
- Modify: `apps/client/src/features/home/Home.tsx` (render student view; `TeachersPanel` when `staff.manage`), `apps/client/src/features/home/StudentsPanel.tsx` or `StudentRow.tsx` (student name opens the student page when `results.view` — pass `onStudent` down)

**Interfaces:**
- Consumes: `GET /api/v1/results/students/:id`, `GET /api/v1/results/teachers`.
- Produces: `StudentResultsPage({ studentId, onBack })`, `TeachersPanel()`.

- [ ] **Step 1: Implement** `StudentResultsPage`: back button, header (name, roll, class/section), three tiles (Quizzes taken, Average %, Grade — "—" when none), "By subject" rows with a bar, attempts and grade, "Quiz history" list (date, quiz title, score/total, percent). Empty state: "No quizzes taken yet."
- [ ] **Step 2: Implement** `TeachersPanel` (title "Teachers"): table Name, Quizzes made, Quizzes run, Students reached, Last signed in ("Never" when null).
- [ ] **Step 3: Run** `just check` and `just test` — Expected: clean, all pass.
- [ ] **Step 4: Check in the real app**: `just server` + `just app`, sign in as admin and as priya; dashboard shows bands for the existing "Fractions quiz" run (Asha 5/5, Rohan 4/5, Manas 3/5); open Asha's page; download CSV and open it.
- [ ] **Step 5: Commit** `feat(results): student page and teacher activity for Super Admin`
