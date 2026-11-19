# Board Broadcast Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Show to class" works for PDFs, pictures and a blank whiteboard, with the class following the teacher's page and writing kept per page.

**Architecture:** The in-memory show on the server gains a kind, a page and a page count; ink strokes carry the page they belong to. A new `PUT /shows/:id/page` moves every screen. The client draws PDFs itself with pdf.js (streamed in parts through the existing `ictfile:` address), and the ink board shows only the current page's lines.

**Tech Stack:** zod contracts, Fastify + vitest (server), React 19 + Tauri 2 + vitest (client), `pdfjs-dist` (new).

**Spec:** `docs/superpowers/specs/2026-11-19-board-broadcast-design.md`

## Global Constraints

- One show per class at a time; starting a new show replaces the old one (unchanged).
- Pages are 1-based. Video shows always use page 1.
- `INK_STROKES_MAX` (300) applies **per page**; new `INK_SHOW_STROKES_MAX = 1500` per show.
- `WHITEBOARD_PAGES_MAX = 30`. `WHITEBOARD_ASPECT = 16 / 9`.
- Only small messages travel: page numbers and pen points. No screen pictures.
- Everything works offline: pdf.js worker, fonts and cmaps are bundled with the app.
- Students in My Books keep the browser's built-in PDF reader (iframe). The new reader is for the teacher's Viewer and the student's show screen.
- No zoom. Every screen shows the whole page.
- Copy follows the codebase's plain-English style ("Your teacher has moved to another page.").
- After any contract change: `just openapi` and commit `contracts/openapi.json`.

## Review Focus

1. A student is mid-line when the teacher turns the page: the server refuses the rest of the line (`409 WRONG_PAGE`), the student's screen drops it and says why. Test: Task 2.
2. A student who joins late on page 7 sees page 7 and only page 7's lines, though the server holds lines for many pages. Tests: Task 2 (server returns pages), Task 3 (board filters).
3. A whiteboard has no library item: removing library items or the stale-item check must not end it. Test: Task 1.
4. Page numbers out of range: page 0, a page past a known count, a 31st whiteboard page, a page on a video, page 2 of a picture. All refused with 400. Test: Task 1.
5. Streaming a PDF fails on one PC: it falls back to downloading the whole file and still opens. Check: Task 4 step and Task 8 harness run.

---

### Task 1: Contracts and server — PDF, picture and whiteboard shows that move by page

**Files:**
- Modify: `contracts/src/shows.ts`, `contracts/src/api.ts:139-149`, `contracts/openapi.json` (generated)
- Modify: `server/src/modules/shows/show.service.ts`, `server/src/modules/shows/shows.routes.ts`, `server/src/container.ts:142`
- Test: `server/test/shows.test.ts` (new `describe('Showing pages')`)

**Interfaces:**
- Produces (contracts):
  - `ShowKind = z.enum(['video', 'pdf', 'image', 'whiteboard'])`
  - `Show` gains `kind: ShowKind`, `page: number` (int ≥ 1), `pages: number | null`; `item` becomes `ContentItem.nullable()`.
  - `ShowStart = z.union([z.object({ contentId: Id }), z.object({ whiteboard: z.literal(true), classId: Id })])`
  - `ShowPage = z.object({ page: z.number().int().min(1).max(5000), pages: z.number().int().min(1).max(5000).optional() })`
  - `WHITEBOARD_PAGES_MAX = 30`, `WHITEBOARD_ASPECT = 16 / 9`, `INK_SHOW_STROKES_MAX = 1500`
  - API: `'PUT /api/v1/shows/:id/page': { summary: 'Move every screen of the class to this page; a whiteboard may also gain a page', access: staff('lesson.present'), params: IdParams, body: ShowPage, status: 200, response: Show }`
- Produces (server): `ShowService.start(actor, input: ShowStart): Show`, `ShowService.page(actor, id, input: ShowPage): Show`. Constructor gains a last parameter `className: (classId: string) => string | undefined` (wire with the classes repository in `container.ts`).

- [ ] **Step 1: Write the failing tests** in `server/test/shows.test.ts`, reusing `school()` (add an `upload` of `pdf()` and of a small PNG as `book` and `picture` for Class 7):

```ts
describe('Showing pages', () => {
  it('shows a PDF on page 1 and moves every screen when the teacher turns the page', async () => {
    // start(ravi, book.id) → 201, { kind: 'pdf', page: 1, pages: null, item: { id: book.id } }
    // PUT /shows/:id/page { page: 1, pages: 12 } → { page: 1, pages: 12 }
    // PUT /shows/:id/page { page: 5 } → pc.last() matches { page: 5, pages: 12 }
  });
  it('shows a picture as one page', async () => {
    // start → { kind: 'image', page: 1, pages: 1 }; page { page: 2 } → 400
  });
  it('starts a whiteboard for a class the teacher teaches, and adds pages up to 30', async () => {
    // POST /shows { whiteboard: true, classId: c7.id } → 201 { kind: 'whiteboard', item: null, className: '7', page: 1, pages: 1 }
    // page { page: 2, pages: 2 } → ok; page { page: 4, pages: 4 } → 400 (grows by one at most)
    // after reaching 30 pages, { page: 31, pages: 31 } → 400
    // POST /shows { whiteboard: true, classId: c8.id } as ravi → 404
  });
  it('refuses pages that do not exist', async () => {
    // pdf with pages 12: { page: 13 } → 400; { page: 0 } → 400 (schema)
    // video show: PUT /shows/:id/page → 400 'A video has no pages.'
    // pdf show: PUT /shows/:id { playing: true, position: 0 } → 400
  });
  it('keeps a whiteboard going when library items change, and ends it when it goes quiet', async () => {
    // delete an unrelated library item → GET /shows/mine still returns the whiteboard
    // clock.t += SHOW_STALE_MS + 1 → mine() is null
  });
  it('refuses sound and web links', async () => {
    // start(ravi, audio.id) → 400 'Only a video, PDF or picture can be shown to the class.'
  });
});
```

Also update the existing `'refuses what cannot be shown…'` test: a PDF is now accepted.

- [ ] **Step 2: Run to see them fail**

Run: `pnpm --filter @ict/server test -- shows`
Expected: FAIL (unknown route `/page`, `kind` missing, PDF refused).

- [ ] **Step 3: Change the contracts**, then `just openapi`.

- [ ] **Step 4: Implement in `show.service.ts`**
  - `Live` gains `kind`, `classId`, `className`, `page`, `pages`; `item` becomes `ContentItem | null`. Replace every `live.item.classId` with `live.classId`.
  - `start`: whiteboard → `seesClass(scopeOf(actor), classId)` and `className(classId)` must exist, else `notFound('Class')`; `pages: 1`. Content → as today, but allow `video | pdf | image`; `pages` is `null` for video and pdf, `1` for image.
  - `page`: refuses with `AppError(400, 'BAD_REQUEST', …)`: video (`'A video has no pages.'`); `page > pages` when pages known; image page ≠ 1; whiteboard `pages` other than current or current+1, or above `WHITEBOARD_PAGES_MAX`. For a PDF, `pages` sets the count. Counts as "still here" (`heardAt`). Notifies the room and logs `show.page` only when something changed.
  - `update` (play/pause) on a non-video → 400 `'Only a video plays.'`.
  - `forClass`: the "item left the library" check only when `live.item` is not null.
  - `words`: title is `live.item?.title ?? 'Whiteboard'`.
  - Route: `route(app, 'PUT /api/v1/shows/:id/page', ({ params, body, principal }) => shows.page(asStaff(principal), params.id, body))`; `POST /shows` passes `body` to `start`.

- [ ] **Step 5: Run the tests**

Run: `pnpm --filter @ict/server test -- shows` → PASS. `pnpm typecheck` will fail in the client until Task 3; that is expected here.

- [ ] **Step 6: Commit**

```bash
git add contracts server
git commit -m "feat: show a PDF, picture or whiteboard to the class, page by page"
```

### Task 2: Server — writing belongs to a page

**Files:**
- Modify: `contracts/src/shows.ts` (ink types), `contracts/openapi.json`, `server/src/modules/shows/show.service.ts`
- Test: `server/test/shows.test.ts` (`describe('Writing on pages')`)

**Interfaces:**
- Consumes: Task 1's `Show.page`, `ShowPage`.
- Produces: `InkAdd.page: number`, `InkStroke.page: number`, clear event `{ kind: 'clear', show, rev, page }`. `GET /ink` still returns every stroke of the show, each with its page.

- [ ] **Step 1: Write the failing tests**

```ts
describe('Writing on pages', () => {
  it('keeps each page's writing when the teacher turns away and back', async () => {
    // pdf show, pages 12. Teacher writes { page: 1 }, moves to 2, writes { page: 2 }, back to 1.
    // GET /ink → strokes with page 1 and page 2, both kept.
  });
  it('wipes only the page the teacher is on', async () => {
    // lines on pages 1 and 2, teacher on page 2, DELETE /ink → event { kind: 'clear', page: 2 }; page 1 line remains in GET /ink
  });
  it('refuses a line for a page the show is not on', async () => {
    // teacher on page 3; asha (with pen) POST /ink { page: 1 } → 409 'WRONG_PAGE' 'Your teacher has moved to another page.'
  });
  it('lets the student with the pen write on a PDF at any time', async () => {
    // pdf show, pen given to asha, POST /ink { page: 1 } → 204
  });
  it('caps lines per page and per show', async () => {
    // INK_STROKES_MAX lines on page 1 → next on page 1 is 409 INK_FULL, a line on page 2 still works
    // INK_SHOW_STROKES_MAX lines spread across pages → next anywhere is 409 INK_FULL
  });
  it('still wipes a video's writing when it plays or jumps', async () => {
    // existing behaviour, strokes have page 1
  });
});
```

Update existing ink tests to send `page: 1`.

- [ ] **Step 2: Run to see them fail** — `pnpm --filter @ict/server test -- shows` → FAIL.

- [ ] **Step 3: Implement**
  - `write`: `input.page !== live.page` → `AppError(409, 'WRONG_PAGE', 'Your teacher has moved to another page.')` (teacher too). Per-page cap counts strokes with `page === input.page`; show cap counts all.
  - `clear` and `wipe` remove only `live.page`'s strokes and emit `{ kind: 'clear', show, rev, page }`. Video play/jump uses page 1.

- [ ] **Step 4: Run tests** → PASS. **Step 5: Commit** `feat: writing on a show belongs to its page`.

### Task 3: Client ink board shows only the current page

**Files:**
- Modify: `apps/client/src/features/shows/ink-board.ts`, `apps/client/src/features/shows/Ink.tsx` (`useInk`)
- Test: `apps/client/src/features/shows/ink-board.test.ts`

**Interfaces:**
- Consumes: Task 2's `InkStroke.page`, `InkAdd.page`, clear event `page`.
- Produces: `InkBoard.setPage(page: number): void`; `InkBoard.all()` yields only current-page strokes; `begin` stamps the current page; `clear()` wipes only the current page; `near()` looks only at the current page. `useInk(show: { id; classId; inkRev; page } | null, by, byName)` calls `board.setPage(show.page)` when it changes. A failed `add` with `WRONG_PAGE` removes the line and sets `problem` to the server's message (existing path).

- [ ] **Step 1: Write the failing tests**

```ts
it('draws only the lines of the page it is on', () => { /* server has page 1 and page 7 lines; setPage(7) → drawn() is page 7 only; setPage(1) → page 1 only */ });
it('writes new lines on the current page', () => { /* setPage(3); begin(...) → sent[0].page === 3 */ });
it('wipes only the current page when the server says so', () => { /* take({ kind: 'clear', page: 2, ... }) leaves page 1 lines */ });
it('wipes only the current page when this screen wipes', () => { /* setPage(2); clear() → page 1 lines remain */ });
it('changes its picture when the page changes', () => { /* onChange listener fires on setPage */ });
```

- [ ] **Step 2: Run to see them fail** — `pnpm --filter @ict/client test -- ink-board` → FAIL.
- [ ] **Step 3: Implement** (strokes stay in one map; filter on read). Default page is 1.
- [ ] **Step 4: Run tests** → PASS; `pnpm typecheck` → client errors only in `Viewer.tsx`/`ClassShow.tsx` for `item` now nullable; fix with `show.item?.title ?? 'Whiteboard'` and video-only guards so typecheck passes.
- [ ] **Step 5: Commit** `feat: the pen board keeps writing per page`.

### Task 4: PDF pages drawn by the app (pdf.js), streamed in parts

**Files:**
- Create: `apps/client/src/features/content/PdfPages.tsx`
- Modify: `apps/client/package.json` (add `pdfjs-dist`, exact version, newest 5.x at least two weeks old), `apps/client/vite.config.ts` (copy `pdfjs-dist/standard_fonts` and `cmaps` into the build), `apps/client/src-tauri/tauri.conf.json` (CSP), `apps/client/src/features/content/useFileUrl.ts`

**Interfaces:**
- Produces:
  - `useFileUrl(item, opts?: { streamPdf?: boolean })`: with `streamPdf`, a PDF uses `platform.fileUrl(hash)` like videos; `onError` switches to the full download (existing fallback).
  - `<PdfPages url={string} page={number} onPages={(n: number) => void} onAspect={(a: number) => void} onError={() => void} layer={ReactNode} />`: draws `page` whole inside its box (no zoom), reports the page count once and the page's width/height on each page, and places `layer` over the page. Shows "Opening page…" while a page loads.

- [ ] **Step 1: Add the library** — `pnpm --filter @ict/client add pdfjs-dist@<exact>`. Worker via `import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'`.
- [ ] **Step 2: Implement `PdfPages`** — `getDocument({ url, disableAutoFetch: true, rangeChunkSize: 262144, isEvalSupported: false, cMapUrl, cMapPacked: true, standardFontDataUrl })`; render to a canvas at device pixel ratio; cancel the old render task when the page changes; destroy the document on unmount; call `onError` if loading fails.
- [ ] **Step 3: CSP** — add `connect-src 'self' ipc: http://ipc.localhost ictfile: http://ictfile.localhost; worker-src 'self' blob:`.
- [ ] **Step 4: Check in the browser harness** (see memory "Browser harness"): open a library PDF as a teacher, page 1 appears before the whole file downloads (network log shows range requests); turning pages works; with streaming forced to fail, the full download path opens it.
- [ ] **Step 5: Commit** `feat: draw PDF pages in the app, reading big books in parts`.

### Task 5: Teacher shows a PDF or picture and turns pages

**Files:**
- Create: `apps/client/src/features/shows/useShowHost.ts`
- Modify: `apps/client/src/features/content/Viewer.tsx`

**Interfaces:**
- Consumes: Tasks 1–4.
- Produces: `useShowHost(start: ShowStart): { showing: boolean; live: Show | null; start(): Promise<void>; stop(): Promise<void>; turn(page: number, pages?: number): void; givePen(studentId: string | null): Promise<void>; error: string | null }`. Moves today's start/stop/beat/410/404 handling out of `Viewer.tsx`. On 404 it starts again and re-sends the current page. Video's play/pause `tell` keeps using `live.id`.

- [ ] **Step 1: Extract `useShowHost`** with no change in video behaviour; run `pnpm --filter @ict/client test` and the harness video show → still works.
- [ ] **Step 2: Viewer** — staff see PDFs through `PdfPages` (with `streamPdf`), students keep the iframe. "Show to Class" for `video | pdf | image`. While showing a PDF: big Previous / Next buttons and "Page 3 of 120"; each turn calls `turn(page)`; after the page count is known, `turn(page, pages)` once. Picture: `InkLayer` over the image with its natural aspect. Pen toolbar with wipe, and the pen-giving row, for all three kinds.
- [ ] **Step 3: Harness check** — teacher shows a PDF, turns to page 3, writes; the show state has `page: 3` and the line has `page: 3`.
- [ ] **Step 4: Commit** `feat: show a PDF or picture to the class and turn its pages`.

### Task 6: Teacher whiteboard

**Files:**
- Create: `apps/client/src/features/shows/Whiteboard.tsx`
- Modify: `apps/client/src/features/home/Home.tsx` (new view `{ kind: 'whiteboard' }`), `apps/client/src/features/content/ContentPanel.tsx` (a "Whiteboard" button, only with `lesson.present`)

**Interfaces:**
- Consumes: `useShowHost({ whiteboard: true, classId })`, `useInk`, `InkLayer` with `aspect={WHITEBOARD_ASPECT}`.
- Produces: `<Whiteboard onBack={() => void} />`.

- [ ] **Step 1: Build it** — pick a class (from `GET /api/v1/classes`), "Start whiteboard", a white 16:9 surface with the pen toolbar, Previous / Next / "Add page" (disabled at 30), "Page 2 of 4", pen giving, Stop. Leaving the screen stops the show (as Viewer does).
- [ ] **Step 2: Harness check** — start, add a page, write on page 2, go back to page 1: page 1 is clean, page 2 keeps its line.
- [ ] **Step 3: Commit** `feat: a whiteboard the teacher can show to the class`.

### Task 7: Student screen follows PDF, picture and whiteboard shows

**Files:**
- Modify: `apps/client/src/features/shows/ClassShow.tsx`

**Interfaces:**
- Consumes: `Show.kind`, `Show.page`, `Show.pages`, `PdfPages`, `useFileUrl(..., { streamPdf: true })`, `WHITEBOARD_ASPECT`.

- [ ] **Step 1: Split by kind** — keep today's video part as is. Add page views: PDF through `PdfPages` at `show.page`; picture; white 16:9 board. Header title `show.item?.title ?? 'Whiteboard'`, and "Page 3 of 120" (or "Page 3" when the count is unknown). The student with the pen can write at any time on these kinds ("You have the pen. Write on the page."). Report `opened`, `ready`, `failed` for the diary as today.
- [ ] **Step 2: Harness check** with two pages open (teacher and student): student follows each page turn, sees only that page's lines, writes with the pen on page 2 and the teacher sees it; teacher turns the page mid-line → student sees "Your teacher has moved to another page."
- [ ] **Step 3: Commit** `feat: students follow the teacher's PDF, picture and whiteboard`.

### Task 8: Whole check

- [ ] **Step 1:** `pnpm test && pnpm typecheck && pnpm lint` → all pass.
- [ ] **Step 2:** One harness run end to end: video show still works as before (play, pause, pen pauses, wipe on play); PDF, picture and whiteboard shows as in Tasks 5–7; a student joining late lands on the current page with its lines.
- [ ] **Step 3:** Push the branch (`git pull --rebase` first, never force) and open a PR.
