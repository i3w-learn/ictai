# Quizzes and Lab Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Teachers write quizzes by hand and run them in Lab Mode (v2 parity, no AI): show a 6-digit code, students on lab PCs join, the teacher starts, each student answers at their own pace with a timer per question, the teacher watches live progress and a leaderboard, then ends the run.

**Architecture:** Writes go over the existing REST API (an answer's HTTP 200 *is* its ack). Live updates go over a new WebSocket relay at `wss://<server>:7700/relay` (spec 8.3 envelope). The relay only pushes: a client joins a room (`quiz:<runId>`) and the server sends a full `state` snapshot on join and after every change. The web view cannot trust the self-signed certificate, so the WebSocket lives in Rust (`relay.rs`, reusing `FingerprintVerifier`) and reaches React as Tauri events.

**Tech Stack:** Fastify 5 + `@fastify/websocket` 11, better-sqlite3, zod; Rust `tokio-tungstenite` (rustls); React.

**Spec:** `docs/ict-app-final-spec.md` — 4.3 "Quizzes & polls", 6 "Today" / "In-lesson view", 8.3 relay rules. v2 reference: `ICT-AI-v2/src/pages/{CreateQuiz,LabSession,Join}.jsx`.

## Global Constraints

- Relay envelope: `{"t","room","seq","ts","id","p"}`; `seq` = server order per room, `ts` = server clock.
- Relay auth: session token in the `Authorization: Bearer` header on the upgrade, never in the URL.
- Messages over 64 KB are rejected (`maxPayload: 65536`). Every handler is wrapped: a bad message is logged and dropped, never crashes the server.
- Late joiners get the current state at once (snapshot on `join`).
- Reconnect waits 1, 2, 4 … up to 30 s, then rejoins every room.
- Join codes: 6 digits, unique among open runs (lobby or active), die when the run ends. Wrong guesses rate-limited (existing `FailureLimiter`, 5 tries / 5 min per device).
- Question type for now: single choice, 2–6 options, one correct option, marks 1–10. Seconds per question 10–600 (v2 default 5 min = 300).
- A student may only join a run for their own class.
- An answer counts only while the run is `active`; first answer to a question wins (resends are harmless).
- Permissions: quiz create/edit/delete = `teaching.manage`; open/start/end a run = `lesson.start` / `lesson.control`.

## Review Focus

1. A student's PC loses the connection mid-quiz → reconnects with backoff, rejoins, gets the current state; answers already sent are kept. (Task 5 test `rejoins rooms after reconnect`; Task 3 test `resending an answer is harmless`.)
2. A student joins after the teacher pressed Start → they get the running quiz straight away. (Task 3 test `late joiner gets the active state`.)
3. The teacher ends the run while a student is mid-question → the student's next answer is refused and their screen shows "Quiz ended". (Task 3 test `answers after end are refused`.)
4. A Class 8 student types the code of a Class 7 run → refused with a clear message. (Task 3 test `refuses a student from another class`.)
5. The student view never contains the correct answers before they finish. (Task 3 test `student state hides correct answers`.)

---

### Task 1: Contracts

**Files:** Create `contracts/src/quizzes.ts`, `contracts/src/relay.ts`; modify `contracts/src/index.ts`, `contracts/src/api.ts`.

- `Access` gains `{ kind: 'student' }`; `server/src/core/route.ts` `checkAccess` handles it.
- `quizzes.ts`: `Question {text, options: string[2..6], correct: int, marks: int 1..10}`; `QuizInput {title, classId, subject?, topic?, secondsPerQuestion, questions: Question[1..100]}`; `Quiz = QuizInput + {id, totalMarks, updatedAt}`; `QuizSummary {id, title, classId, subject, topic, questionCount, totalMarks, updatedAt}`.
- Runs: `RunStatus = 'lobby'|'active'|'ended'`; `RunParticipant {studentId, name, rollNo, answered, correct, score, finished}`; `TeacherRunState {kind:'teacher', runId, quizId, title, className, joinCode|null, status, questionCount, totalMarks, participants[]}` (sorted by score desc, then name); `StudentRunState {kind:'student', runId, title, status, secondsPerQuestion, questions: {text, options}[], myAnswers: (int|null)[], finished, score|null, totalMarks}`; `RunSummary {id, quizId, title, status, joinCode|null, createdAt, participants}`.
- Relay: `RelayEnvelope {t, room?, seq?, ts, id?, p?}`; client messages `ClientMsg = join{room} | leave{room} | ping`.
- API rows:

| Key | access | in | status | out |
|---|---|---|---|---|
| `GET /api/v1/quizzes` | staff() | query `{classId?}` | 200 | `QuizSummary[]` |
| `POST /api/v1/quizzes` | staff('teaching.manage') | `QuizInput` | 201 | `Quiz` |
| `GET /api/v1/quizzes/:id` | staff() | params | 200 | `Quiz` |
| `PUT /api/v1/quizzes/:id` | staff('teaching.manage') | `QuizInput` | 200 | `Quiz` |
| `DELETE /api/v1/quizzes/:id` | staff('teaching.manage') | params | 204 | — |
| `POST /api/v1/quiz-runs` | staff('lesson.start') | `{quizId}` | 201 | `TeacherRunState` |
| `GET /api/v1/quiz-runs` | staff() | query `{quizId}` | 200 | `RunSummary[]` |
| `GET /api/v1/quiz-runs/:id` | staff() | params | 200 | `TeacherRunState` |
| `POST /api/v1/quiz-runs/:id/start` | staff('lesson.control') | params | 200 | `TeacherRunState` |
| `POST /api/v1/quiz-runs/:id/end` | staff('lesson.control') | params | 200 | `TeacherRunState` |
| `POST /api/v1/quiz-runs/join` | student | `{code}` | 200 | `StudentRunState` |
| `GET /api/v1/quiz-runs/:id/play` | student | params | 200 | `StudentRunState` |
| `POST /api/v1/quiz-runs/:id/answers` | student | `{questionIndex, choice}` | 200 | `{accepted: boolean}` |
| `POST /api/v1/quiz-runs/:id/finish` | student | params | 200 | `StudentRunState` |

- [ ] Add schemas + rows; `pnpm --filter @ict/contracts openapi`; contract test fails listing the new keys.

### Task 2: Relay on the server

**Files:** Create `server/src/relay/relay.ts`, `server/src/relay/relay.routes.ts`, `server/test/relay.test.ts`; modify `server/src/app.ts`, `server/src/container.ts`, `server/package.json`.

- `interface RoomKind { prefix: string; canJoin(p: Principal, id: string): boolean; snapshot(p: Principal, id: string): unknown }`
- `class Relay { register(kind: RoomKind); notify(room: string); attach(socket, principal) }` — keeps `Map<room, Set<Conn>>` and `seq` per room; on `join` checks `canJoin` (else `error {code:'FORBIDDEN'}`), adds the conn and sends `state`; `notify` sends each member a fresh snapshot computed for that member.
- Connect: resolve the bearer token with `PrincipalResolver`; no principal → close with code 4401. Send `hello {serverTime}` first. `ping` → `pong {ts}`.
- Tests use `app.injectWS('/relay', { headers })`: rejects without a token; `hello` on connect; `ping`→`pong`; join an unknown room kind → `error`; a registered test room delivers `state` on join and again on `notify`, with `seq` increasing; a 70 KB message closes nothing and is dropped/rejected per `maxPayload`.

### Task 3: Quizzes and runs on the server

**Files:** Create `server/src/modules/quizzes/{quiz.repository,run.repository,quiz.service,run.service,quizzes.routes}.ts`, `server/test/quizzes.test.ts`; migration 3 in `server/src/infra/db/migrations.ts`.

- Migration 3: `quizzes(id, title, class_id, subject, topic, seconds_per_question, questions_json, created_by, status active|deleted, created_at, updated_at)`; `quiz_runs(id, quiz_id, class_id, join_code, status, started_by, created_at, started_at, ended_at)`; `quiz_participants(run_id, student_id, device_id, joined_at, finished_at, PK(run_id, student_id))`; `quiz_answers(run_id, student_id, question_index, choice, correct, answered_at, PK(run_id, student_id, question_index))`. The run keeps its own copy of the questions? **No** — editing a quiz while it runs is refused (409) instead.
- `RunService` calls `relay.notify('quiz:<runId>')` after open/start/end/join/answer/finish; registers the `quiz` room kind (teacher: staff; student: participant of the run).
- Tests (with `testServer`): CRUD round-trip and validation (`correct` out of range → 400); a teacher cannot edit a quiz with a live run (409); open run → 6-digit code; student joins by code (lobby), `refuses a student from another class`, wrong code 404 and rate-limited after 5; `student state hides correct answers` (no `correct` key anywhere in the JSON); answers refused in lobby; start → answers accepted, score = sum of marks of correct answers; `resending an answer is harmless`; `late joiner gets the active state`; finish → state has `finished: true` and `score`; `answers after end are refused`; ended run's code no longer joins; teacher state lists participants sorted by score.

### Task 4: Relay in Rust

**Files:** Create `apps/client/src-tauri/src/relay.rs`; modify `lib.rs`, `Cargo.toml`.

- `tokio-tungstenite` with rustls; TLS config built from `FingerprintVerifier::new(Some(fp))` (factor `tls_config(verifier)` out of `http.rs` and reuse it).
- Commands: `relay_open(base_url, cert_fp, token)` (replaces any open socket), `relay_send(text)`, `relay_close()`. Incoming text → event `relay://message` (string). Closed or failed → event `relay://closed` (`{ reason }`).
- Unit test: `ws_url("https://10.0.0.5:7700")` → `wss://10.0.0.5:7700/relay`. Live check in the existing `e2e` module (skipped unless `ICT_E2E=1`): connect with an admin token, receive `hello`.

### Task 5: Relay client in React

**Files:** Create `apps/client/src/core/relay-client.ts`, `apps/client/src/core/relay-client.test.ts`; modify `platform/platform.ts`, `platform/tauri-platform.ts`, `app/app-context.tsx`.

- `Platform` gains `relayOpen(baseUrl, certFp, token)`, `relaySend(text)`, `relayClose()`, `onRelay(listener): () => void`.
- `class RelayClient { status: 'off'|'connecting'|'online'|'reconnecting'; connect(token); disconnect(); subscribe(room, onState): () => void; onStatus(fn) }` — joins on subscribe, leaves on last unsubscribe, reconnect delays `[1,2,4,8,16,30]` s, rejoins all rooms after reconnect.
- `useRelayRoom(room)` hook in `app-context.tsx` returns the latest `state` for a room; the context connects the relay while a session exists and disconnects on sign-out.
- Tests with a fake platform (vitest fake timers): joins on subscribe; `rejoins rooms after reconnect` (delays 1 s then 2 s); routes `state` by room; leave on last unsubscribe.

### Task 6: Teacher screens

**Files:** Create `apps/client/src/features/quizzes/{QuizzesPanel,QuizEditor,LabSession}.tsx`; modify `features/home/Home.tsx`.

- `QuizzesPanel` (console, `teaching.manage`): class filter, list with question count and marks, New / Edit / Delete (inline confirm) / **Start Lab Mode**.
- `QuizEditor`: title, class, subject, topic, seconds per question; questions with 2–6 options, a radio for the correct one, marks. Save disabled until valid. Ported from v2's `ManualQuizDialog`.
- `LabSession`: full page; big join code; "Students joined" chips live; **Start quiz**; live table (answered / correct / score, ✓ when finished); **End quiz** (inline confirm); then the leaderboard. All live data from `useRelayRoom('quiz:<id>')`.

### Task 7: Student screens

**Files:** Create `apps/client/src/features/quizzes/{JoinQuiz,PlayQuiz}.tsx`; modify `features/home/Home.tsx`.

- Student home: "Join a quiz" with a 6-digit code field (spec 6 "Today"). Clear messages for wrong code / other class / ended.
- `PlayQuiz`: lobby ("Waiting for your teacher to start"); one question at a time with a countdown bar (auto-moves on at 0); tap an option → `POST answers` → next; last → `finish`; result screen with score; "Quiz ended" when the run ends. Status chip shows "Reconnecting…" from `RelayClient.status`.

### Task 8: End-to-end check and docs

- `just server` + `just app` twice (Server PC and Student PC): create a quiz, run Lab Mode, join, answer, watch the teacher table update, end.
- README: add the relay to the layout section.
