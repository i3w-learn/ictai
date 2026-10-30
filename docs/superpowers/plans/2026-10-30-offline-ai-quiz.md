# Offline AI Quiz Maker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A teacher or Super Admin types a class, subject, topic, number of questions and language (English or Hindi), and a few minutes later gets a draft quiz, made fully offline on the Server PC, with doubtful questions marked "Please check", which they review in the existing quiz editor before saving.

**Architecture:** The server starts `llama-server` (llama.cpp) as a child process on `127.0.0.1` only, at low OS priority, with the model file from the server's data folder. AI requests become rows in an `ai_jobs` table; one worker runs one job at a time. A job (1) asks the model for questions under a JSON schema so the reply always parses, (2) checks each question in code, (3) asks the model to answer each question again in a fresh request and marks a mismatch "Please check". The client polls the job and opens the result in `QuizEditor`; nothing becomes a quiz until the teacher saves.

**Tech Stack:** llama.cpp `llama-server` (OpenAI-style `/v1/chat/completions` with `response_format: json_schema`), Gemma 4 31B-it Q8_0 GGUF (school server) / Gemma 4 E2B-it Q4_K_M (dev Mac), Node 22 `child_process` + `os.setPriority`, Fastify 5, better-sqlite3, zod, React.

**Spec:** `docs/ict-app-final-spec.md` section 9 "Offline AI", section 12 (models, `:559-560`), M5 (`:669`). Decisions made with the user on 2026-10-30 (below) override the spec where they differ; Task 7 writes them back into the spec.

## Decisions agreed with the user (2026-10-30)

- Who: staff with `ai.teacher` (teachers and Super Admin already have it, `server/src/modules/auth/permissions.ts:21`). Students never call the AI.
- Languages: English and Hindi, written directly by the model (no IndicTrans2 in Part 1).
- Accuracy over speed: "slow is acceptable, not inaccurate". School server: 128 GB RAM, 1 TB SSD, wired Ethernet. Model: **Gemma 4 31B-it Q8_0** (`unsloth/gemma-4-31B-it-GGUF`, file `gemma-4-31B-it-Q8_0.gguf`, 32.6 GB). Fallback if too slow: Gemma 4 26B-A4B. Backup family: Qwen.
- Part 1 = topic → draft quiz. Part 2 (textbook upload, search, questions from book pages with page citations) is a separate later plan.

## Global Constraints

- The AI runtime listens on `127.0.0.1` only, port `7702` (API is 7700, beacon 7701). Never on `0.0.0.0`.
- No model installed → every `/api/v1/ai/*` except `/ai/status` returns `503 { code: 'AI_NOT_INSTALLED', message: 'AI is not installed on this server.' }`; the UI shows an empty state (spec 9).
- One request per user at a time → second one gets `409 AI_BUSY` "You already have a quiz being made. Wait for it to finish." (spec 9).
- One job runs at a time across the server; others wait in order; the user sees their place in line (spec 9).
- Live lessons first: the runtime process runs at `os.constants.priority.PRIORITY_LOW`, so Lab Mode requests always win the CPU (spec 9 "live lesson > teacher").
- Timeout per job: **15 minutes** (changed from the spec's 120 s because the user accepts slow, accurate output; Task 7 updates the spec).
- AI jobs (prompts and outputs) are deleted after **90 days** (spec 9).
- Model output is never trusted: every reply is parsed with zod even though the schema forces its shape.
- Copy is plain English, no jargon: "Making your quiz…", "You are number 2 in line", "Please check: the AI gave a different answer when asked again."
- Question shape stays `contracts/src/quizzes.ts` `Question`: single choice, here always exactly 4 options, `correct` is the option index, `marks` 1.

## Review Focus

1. The server restarts while a job is running → that job shows "failed: The server restarted. Try again." instead of staying "running" forever. (Task 3 test `marks running jobs failed on start`.)
2. The model returns fewer good questions than asked (some dropped by the code check) → it asks again for the missing ones, at most 2 extra rounds, then returns what it has with a note. (Task 4 test `tops up dropped questions`.)
3. Hindi requested but the model answers in English (or the reverse) → that question is dropped by the language check. (Task 4 test `drops questions in the wrong language`.)
4. `llama-server` crashes mid-job → the job fails with "The AI stopped unexpectedly. Try again." and the runtime restarts for the next job. (Task 2 test `restarts after the process exits`; Task 3 test `fails the job when the model call throws`.)
5. A teacher opens another teacher's job id → 404, not someone else's draft. (Task 5 test `cannot read another user's job`.)

---

### Task 1: Contracts

**Files:**
- Create: `contracts/src/ai.ts`
- Modify: `contracts/src/index.ts` (export), `contracts/src/api.ts` (4 rows), `contracts/openapi.json` (via `just openapi`)
- Test: `server/test/contract.test.ts` already checks the server serves exactly the API table; it will fail until Task 5.

**Interfaces:**
- Produces (all in `contracts/src/ai.ts`):
  - `AiLanguage = z.enum(['en', 'hi'])`
  - `AiQuizRequest = z.object({ classId: Id, subject: z.string().trim().min(1).max(60), topic: z.string().trim().min(1).max(120), count: z.number().int().min(1).max(20).default(10), language: AiLanguage.default('en') })`
  - `AiFlag = z.object({ ok: z.boolean(), note: z.string().nullable() })`
  - `AiQuizResult = z.object({ questions: z.array(Question), flags: z.array(AiFlag), note: z.string().nullable() })` — `flags[i]` belongs to `questions[i]`; `note` e.g. "Only 8 of 10 questions passed the checks."
  - `AiJobStatus = z.enum(['queued', 'running', 'done', 'failed'])`
  - `AiJob = z.object({ id: z.string(), kind: z.literal('quiz'), status: AiJobStatus, position: z.number().nullable(), request: AiQuizRequest, result: AiQuizResult.nullable(), error: z.string().nullable(), createdAt: z.number(), finishedAt: z.number().nullable() })` — `position` is 1-based place in line while `queued`, else `null`.
  - `AiStatus = z.object({ installed: z.boolean(), model: z.string().nullable(), ready: z.boolean(), queued: z.number() })`
- API rows (all `access: staff('ai.teacher')`):
  - `'GET /api/v1/ai/status'` → 200 `AiStatus`
  - `'POST /api/v1/ai/quiz'` body `AiQuizRequest` → **202** `AiJob`
  - `'GET /api/v1/ai/jobs'` → 200 `z.array(AiJob)` (caller's last 10, newest first)
  - `'GET /api/v1/ai/jobs/:id'` params `IdParams` → 200 `AiJob`

- [ ] **Step 1:** Write `contracts/src/ai.ts` and the four API rows as above.
- [ ] **Step 2:** Run `just openapi && just check`. Expected: typecheck passes (server contract test fails until Task 5 — expected).
- [ ] **Step 3:** Commit `feat(ai): contracts for the offline quiz maker`.

### Task 2: AI runtime (start, health, stop) and the model client

**Files:**
- Create: `server/src/modules/ai/runtime.ts`, `server/src/modules/ai/llm-client.ts`
- Modify: `server/src/config.ts` (add `ai: { dir: string; port: number; threads: number | null }`; `dir = env.ICT_AI_DIR ?? join(dataDir, 'ai')`, `port = Number(env.ICT_AI_PORT ?? 7702)`, `threads = env.ICT_AI_THREADS ? Number(...) : null`)
- Test: `server/test/ai-runtime.test.ts`

**Interfaces:**
- AI folder layout (what the USB kit / dev script puts there): `<ai.dir>/manifest.json` = `{ "name": "Gemma 4 31B", "file": "gemma-4-31B-it-Q8_0.gguf", "sha256": "<hex>", "ctx": 16384 }`, the `.gguf` file, and `llama-server` (`llama-server.exe` on Windows). If `ICT_AI_BIN` is set, use that binary instead (dev Mac: `brew install llama.cpp`).
- Produces in `runtime.ts`:
  - `interface Spawner { spawn(bin: string, args: string[]): ChildLike }` with `ChildLike = { pid?: number; on(e: 'exit', fn: (code: number | null) => void): void; kill(): void }` (real one wraps `child_process.spawn`, stdio to `<dataDir>/ai.log`).
  - `class AiRuntime` — `constructor(cfg: Config['ai'], spawner: Spawner, fetchFn: typeof fetch, setPriority: (pid: number, p: number) => void)`; `installed(): { name: string } | null` (manifest + model file exist); `async ensureReady(): Promise<void>` (spawns if not running, polls `GET http://127.0.0.1:<port>/health` every 1 s until 200, up to 10 min for a 33 GB model; throws `aiNotInstalled()` when not installed); `isReady(): boolean`; `stop(): void`. On exit of the child, mark not running so the next `ensureReady` respawns.
  - Spawn args: `['-m', <model>, '--host', '127.0.0.1', '--port', String(port), '-c', String(ctx), '--jinja']` plus `['-t', String(threads)]` when set. After spawn, `setPriority(pid, os.constants.priority.PRIORITY_LOW)`.
  - `aiNotInstalled = () => new AppError(503, 'AI_NOT_INSTALLED', 'AI is not installed on this server.')` — add to `server/src/core/errors.ts`.
- Produces in `llm-client.ts`:
  - `interface Llm { json<T>(req: { system: string; user: string; schema: ZodType<T>; maxTokens: number; signal: AbortSignal }): Promise<T> }`
  - `class LlamaServerLlm implements Llm` — POSTs `/v1/chat/completions` with `{ messages, max_tokens, temperature: 0.3, response_format: { type: 'json_schema', json_schema: { name: 'out', schema: z.toJSONSchema(schema) } } }`, then `schema.parse(JSON.parse(choices[0].message.content))`. Calls `runtime.ensureReady()` first.

- [ ] **Step 1: Failing tests** in `server/test/ai-runtime.test.ts` with a fake spawner and fake fetch:
  - `not installed without a manifest` → `installed()` is `null`; `ensureReady()` rejects with code `AI_NOT_INSTALLED`.
  - `starts llama-server on localhost at low priority` → spawn args contain `'--host', '127.0.0.1'` and `'--port', '7702'`; `setPriority` called with the child pid and `PRIORITY_LOW`.
  - `waits for /health` → fake fetch returns 503 twice then 200; `ensureReady()` resolves; spawner called once even if `ensureReady()` is called twice at the same time.
  - `restarts after the process exits` → fire child `exit`; next `ensureReady()` spawns again.
  - `LlamaServerLlm parses schema output` → fake fetch returns `{choices:[{message:{content:'{"choice":2}'}}]}`; `json({schema: z.object({choice: z.number()})...})` resolves `{choice: 2}`; request body has `response_format.type === 'json_schema'`.
- [ ] **Step 2:** `cd server && pnpm vitest run test/ai-runtime.test.ts` → FAIL (module missing).
- [ ] **Step 3:** Implement as above. Use fake timers in tests for the 1 s poll.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit `feat(ai): start llama-server on localhost at low priority`.

### Task 3: Job table and queue worker

**Files:**
- Modify: `server/src/infra/db/migrations.ts` (migration 4 `ai_jobs`)
- Create: `server/src/modules/ai/job.repository.ts`, `server/src/modules/ai/job-queue.ts`
- Test: `server/test/ai-queue.test.ts`

**Interfaces:**
- Migration 4:
  ```sql
  CREATE TABLE ai_jobs (
    id           TEXT PRIMARY KEY,
    kind         TEXT NOT NULL CHECK (kind IN ('quiz')),
    requested_by TEXT NOT NULL REFERENCES users(id),
    request_json TEXT NOT NULL,
    status       TEXT NOT NULL CHECK (status IN ('queued','running','done','failed')),
    result_json  TEXT,
    error        TEXT,
    created_at   INTEGER NOT NULL,
    started_at   INTEGER,
    finished_at  INTEGER
  );
  CREATE INDEX ai_jobs_queue ON ai_jobs(status, created_at);
  CREATE INDEX ai_jobs_user ON ai_jobs(requested_by, created_at);
  ```
- `JobRepository(db)`: `insert(job)`, `get(id): AiJob | null`, `listFor(userId, limit): AiJob[]`, `hasOpen(userId): boolean` (queued or running), `nextQueued(): row | null`, `position(id): number | null` (count of queued with `created_at <=` this one), `markRunning/markDone/markFailed(id, ..., now)`, `failRunning(error, now)`, `purgeBefore(ts)`.
- `JobQueue` — `constructor(now: Clock, repo: JobRepository, run: (request: AiQuizRequest, signal: AbortSignal) => Promise<AiQuizResult>, timeoutMs = 15 * 60_000)`; `start()` (calls `repo.failRunning('The server restarted. Try again.', now())` and `repo.purgeBefore(now() - 90 days)`, then kicks the loop); `enqueue(userId, request): AiJob` (throws `409 AI_BUSY` when `hasOpen`); `idle(): Promise<void>` (resolves when no job is running — for tests). Worker: take `nextQueued`, mark running, call `run` with an `AbortSignal.timeout(timeoutMs)`, mark done or failed. Error text: timeout → "Making the quiz took too long. Try fewer questions."; `AI_NOT_INSTALLED` → its message; anything else → "The AI stopped unexpectedly. Try again." Then loop.

- [ ] **Step 1: Failing tests** in `server/test/ai-queue.test.ts` (in-memory db from `openDb(':memory:')`, a staff user from `testServer()` or a direct insert, fake `run`):
  - `runs one job at a time in order` → enqueue A (user 1) and B (user 2); `run` resolves manually; while A runs, B has `position: 1` and `status: 'queued'`; after both, both `done` with results.
  - `one open job per user` → second enqueue by the same user throws code `AI_BUSY`.
  - `fails the job when the model call throws` → `run` rejects `new Error('boom')`; job `failed`, error "The AI stopped unexpectedly. Try again."; next job still runs.
  - `fails after the timeout` → `timeoutMs = 50`, `run` waits for the abort; job `failed` with "Making the quiz took too long. Try fewer questions."
  - `marks running jobs failed on start` → insert a `running` row, `start()`; row is `failed` with "The server restarted. Try again."
  - `deletes jobs older than 90 days on start`.
- [ ] **Step 2:** `cd server && pnpm vitest run test/ai-queue.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit `feat(ai): job queue, one job at a time`.

### Task 4: Quiz generator (write → check in code → ask again)

**Files:**
- Create: `server/src/modules/ai/quiz-generator.ts`, `server/src/modules/ai/prompts.ts`
- Test: `server/test/ai-quiz-generator.test.ts`

**Interfaces:**
- Consumes: `Llm` (Task 2), `AiQuizRequest`, `AiQuizResult`, `Question` (Task 1); `ClassRepository` to turn `classId` into the class name.
- Produces: `class QuizGenerator { constructor(llm: Llm, className: (id: string) => string | null); generate(req: AiQuizRequest, signal: AbortSignal): Promise<AiQuizResult> }`.
- Steps inside `generate`:
  1. **Write.** Schema `{ questions: [{ text, options: string[4], correct: 0..3 }] }` (length = still missing). Prompt from `prompts.ts` `writeQuizPrompt({ className, subject, topic, count, language })`: age-appropriate for the class, one clearly right option, three plausible wrong ones, no "all of the above", whole question and options in the chosen language (Hindi in Devanagari).
  2. **Check in code** `checkQuestion(q, language): string | null` (exported, returns the reason it fails): exactly 4 options; options distinct after trim + lower-case; none empty; `correct` 0–3; text ≤ 500 and options ≤ 200 chars; language — `hi` needs Devanagari (`/[ऀ-ॿ]/`) in text and every option except pure numbers, `en` must have none. Also drop exact duplicate question texts.
  3. **Top up.** If fewer than `count` passed, repeat step 1 for the missing number, at most 2 extra rounds. If still short, `note = "Only N of M questions passed the checks."`
  4. **Ask again.** For each kept question, a fresh request (no earlier messages) with options shuffled by a fixed per-question permutation and the answer hidden: schema `{ choice: -1..3 }` where -1 means "no option is right or more than one is". Map the choice back through the permutation. Match → `{ ok: true, note: null }`; otherwise `{ ok: false, note: 'Please check: the AI gave a different answer when asked again.' }`.
  5. Return `{ questions: kept.map(q => ({ ...q, marks: 1 })), flags, note }`. Throw `notFound('Class')` if the class is unknown. Respect `signal` between calls.

- [ ] **Step 1: Failing tests** with a scripted fake `Llm` (returns queued replies, records requests):
  - `returns checked questions with ok flags` → write reply has 3 good English questions; three ask-again replies match → 3 questions, all flags `ok: true`, `note: null`.
  - `flags a question when the second answer differs` → second ask-again reply picks another option → that flag `{ ok: false, note: 'Please check: the AI gave a different answer when asked again.' }`.
  - `ask-again does not reveal the answer` → the ask-again request's `user` text lists the 4 options in the shuffled order and contains no hint of which is right; a reply choosing the shuffled position of the right option maps back to `ok: true`.
  - `drops bad questions` → duplicate options, 3 options, `correct: 5` each dropped (`checkQuestion` returns a reason).
  - `drops questions in the wrong language` → `language: 'hi'` with one English question → dropped; Devanagari question kept.
  - `tops up dropped questions` → asks for 3, first round 1 good, second round 2 good → 3 questions; if rounds run out → `note: 'Only 1 of 3 questions passed the checks.'` and at most 3 write calls.
- [ ] **Step 2:** `cd server && pnpm vitest run test/ai-quiz-generator.test.ts` → FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Same command → PASS.
- [ ] **Step 5:** Commit `feat(ai): quiz generator with code checks and a second answer`.

### Task 5: Wire it into the server (container, routes, startup)

**Files:**
- Create: `server/src/modules/ai/ai.service.ts`, `server/src/modules/ai/ai.routes.ts`
- Modify: `server/src/container.ts`, `server/src/app.ts`, `server/src/main.ts`, `server/test/helpers.ts`
- Test: `server/test/ai.test.ts`

**Interfaces:**
- `createContainer` takes an optional `ai?: { runtime: AiRuntime; llm: Llm }`; when absent (tests that don't care), AI reports not installed. `main.ts` builds the real `AiRuntime` + `LlamaServerLlm` from `config.ai`, calls `c.aiQueue.start()`, and on shutdown `runtime.stop()`.
- `AiService`: `status(): AiStatus`; `requestQuiz(actor: StaffPrincipal, req): AiJob` (throws `aiNotInstalled()` if not installed, `notFound('Class')` if the class doesn't exist, then `queue.enqueue`; writes audit `ai.quiz.request` with the topic); `job(actor, id): AiJob` (404 `notFound('AI job')` unless `requested_by === actor.userId`); `jobs(actor): AiJob[]`.
- `testServer()` gains an option `ai?: { llm: Llm; installed: boolean }` using a fake runtime.

- [ ] **Step 1: Failing tests** in `server/test/ai.test.ts`:
  - `status says not installed` → `GET /api/v1/ai/status` → `{ installed: false, ready: false, model: null, queued: 0 }`.
  - `request returns AI_NOT_INSTALLED without a model` → `POST /api/v1/ai/quiz` → 503 `AI_NOT_INSTALLED`.
  - `teacher gets a draft` → with a fake Llm, POST → 202 `status: 'queued'`; await `c.aiQueue.idle()`; `GET /api/v1/ai/jobs/:id` → `done`, `result.questions.length === count`; no new row in `GET /api/v1/quizzes` (draft only).
  - `cannot read another user's job` → admin's job id read by teacher → 404.
  - `students cannot use AI` → student token → 403.
  - `contract test` (`server/test/contract.test.ts`) passes again.
- [ ] **Step 2:** `cd server && pnpm vitest run test/ai.test.ts test/contract.test.ts` → FAIL.
- [ ] **Step 3:** Implement and wire. Add the audit label "Asked the AI for a quiz on {topic}" in `apps/client/src/features/home/AuditPanel.tsx` (same pattern as the quiz.* labels).
- [ ] **Step 4:** `just test` → all PASS.
- [ ] **Step 5:** Commit `feat(ai): /ai/quiz, job status and startup wiring`.

### Task 6: Screens — "Make quiz with AI" and the flagged editor

**Files:**
- Create: `apps/client/src/features/quizzes/AiQuizMaker.tsx`
- Modify: `apps/client/src/features/quizzes/QuizzesPanel.tsx` (button), `apps/client/src/features/quizzes/QuizEditor.tsx` (accept a draft + flags), `apps/client/src/features/home/Home.tsx` (new view `{ kind: 'ai-quiz' }` and `{ kind: 'edit-quiz', quizId: null, draft?: AiDraft }`)

**Interfaces:**
- `type AiDraft = { request: AiQuizRequest; result: AiQuizResult }`.
- `QuizEditor({ quizId, draft, onDone })` — when `draft` is given: prefill `meta` (`title: "<topic> quiz"`, `classId`, `subject`, `topic`, minutes `'1'`), `questions` from `result.questions`, and show the `result.note` in a `Note` at the top. A flagged question's card gets `border-destructive` and its note text above the question; the flag clears when the teacher edits that question (they have checked it). Save works exactly as today (`POST /api/v1/quizzes`).
- `AiQuizMaker({ onDraft, onBack })`:
  - On open: `GET /api/v1/ai/status`. Not installed → empty state "AI is not installed on this server. Ask your Super Admin to install the AI kit." and nothing else.
  - Form: Class (select), Subject, Topic, Questions (1–20, default 10), Language (English / हिंदी). Button "Make quiz".
  - After submit: poll `GET /api/v1/ai/jobs/:id` every 3 s. Show "You are number N in line" while queued, "Making your quiz… this can take a few minutes. You can keep working; it will be under Recent AI quizzes." while running, the error text + "Try again" when failed, and on done call `onDraft({ request, result })`.
  - Below the form, "Recent AI quizzes": `GET /api/v1/ai/jobs`, each done job has "Open in editor" (so leaving the screen loses nothing).
- `QuizzesPanel`: a quiet button "Make quiz with AI" next to "New quiz", shown when the principal has `ai.teacher`.

- [ ] **Step 1:** Implement the three screens as above.
- [ ] **Step 2:** `just check && just test` → PASS.
- [ ] **Step 3: Check in the real app (dev model).** `brew install llama.cpp`; download `https://huggingface.co/unsloth/gemma-4-E2B-it-GGUF/resolve/main/gemma-4-E2B-it-Q4_K_M.gguf` (3.1 GB) into `server/.data/ai/` with a `manifest.json`; run `ICT_AI_BIN=$(which llama-server) just server` and `just app`. As teacher: make a 5-question English quiz and a 5-question Hindi quiz; both open in the editor; Hindi shows in Devanagari; save one and start Lab Mode. Screenshot each step.
- [ ] **Step 4:** Commit `feat(ai): make a quiz with AI and review flagged questions`.

### Task 7: Install recipe, benchmark on the school server, spec update

**Files:**
- Create: `server/scripts/ai-bench.ts`
- Modify: `justfile` (recipes below), `docs/ict-app-final-spec.md` (`:559-560`, `:669`, section 9 timeout line)

**Interfaces:**
- `just ai-dev` — downloads the dev model (E2B Q4_K_M) into `server/.data/ai/` and writes its `manifest.json` (with sha256).
- `just ai-install <folder>` — copies `manifest.json`, the `.gguf` and `llama-server(.exe)` from a USB folder into the server's AI folder and checks the file's sha256 against the manifest; prints "AI installed: Gemma 4 31B" or the mismatch.
- `server/scripts/ai-bench.ts` — `tsx server/scripts/ai-bench.ts --topics topics.txt --lang en|hi --count 10`: runs `QuizGenerator` directly against the installed runtime for each topic line, writes `ai-bench-<date>.csv` with columns `topic, language, question, options, ai_answer, flagged, seconds` plus an empty `teacher_says_correct` column, and prints average seconds per quiz.

- [ ] **Step 1:** Write the recipes and script; run `just ai-dev` and the bench with 2 topics on the Mac → CSV written, seconds printed.
- [ ] **Step 2:** Update the spec: model line → "Gemma 4 31B-it Q8_0 on the 128 GB school server (fallback Gemma 4 26B-A4B; backup Qwen)"; M5 target → "valid quiz on the school server (128 GB RAM)"; section 9 timeout → "15 min per job (accuracy over speed)".
- [ ] **Step 3:** Commit `chore(ai): install recipe, benchmark script, spec update`.
- [ ] **Step 4 (on the school Server PC, with the user):** copy the 31B kit, run the bench with 10 English and 10 Hindi topics. A teacher fills `teacher_says_correct` for ~100 questions. Record: minutes per 10-question quiz, % correct, % of wrong questions that were flagged. If a quiz takes over 15 minutes, switch to Gemma 4 26B-A4B and repeat.

---

## Not in this plan

- Part 2: textbook upload, text extraction, search index, questions from book pages with page citations (needs the content library, spec 4.x).
- Lesson plans, Ask the library, tutor, translation (`/ai/lesson-plan`, `/ai/ask`, `/ai/tutor`, `/ai/translate`).
- Signed model packages and the USB kit format (spec 10); Part 1 checks sha256 only.
- Flagging wrong answer keys from students' results after a quiz.
