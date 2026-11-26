# Board broadcast: show PDFs, pictures and a whiteboard to the class

Date: 2026-11-19 · Status: approved by the user in chat

## Why

The teacher plugs the Server laptop into the smart board (HDMI for the picture, USB for touch). She
teaches on the board with a pen. Whatever she shows and writes must appear on every student laptop
of that class, at once. Students also have pen tablets.

Today "Show to class" does this, but only for **videos**. Teachers mostly teach from books (PDFs in
the library, the same files students see in My Books) and from a blank board. This change makes
"Show to class" work for those too.

## Goals

- A teacher opens a **PDF** (book, or slides saved as PDF) and presses **Show to Class**. The same
  PDF opens on every student screen of that class, on the **same page**. When she turns the page,
  every screen turns with her.
- The same for a **picture** (one page).
- A **whiteboard**: a show with no file, only blank pages. The teacher picks the class, can add
  pages and move between them.
- **Writing stays with its page.** Lines written on page 3 are still there when she comes back to
  page 3. Wiping clears only the page she is on.
- The pen, eraser, "give the pen to a student" and late-joiner behaviour work as they do for video
  today.
- Videos behave exactly as today (writing is wiped when the video plays or jumps).

## Non-goals (later, separate pieces of work)

- Present mode (a board-only window without the console). Next after this.
- Several students writing at once, and private notes on a student's own copy. After Present mode.
- PowerPoint files. Teachers save slides as PDF.
- Keeping a whiteboard after the show ends. A show lives in the server's memory; when it ends, the
  writing is gone (same as video today).
- My Books remembering the page a student was on.
- Students moving to other pages on their own while a show is on. They follow the teacher.

## Anti-goals

- No sending pictures of the screen over the network. Only small messages (page number, pen
  points) travel; each screen draws for itself.
- Nothing that needs the internet. The PDF reader ships inside the app.

## Constraints

- One show per class at a time (unchanged). Starting a new show replaces the old one.
- Server limits on memory stay: a cap on lines per page and on lines per show.
- Contracts in `contracts/src/shows.ts` and `contracts/src/api.ts` are the single source of truth
  for both sides.

## Approaches considered

1. **Draw PDF pages ourselves with pdf.js (picked).** The app renders each page to a canvas, so it
   knows the page number and the page's exact size, and the pen layer sits exactly on the page.
   Costs a new library (`pdfjs-dist`) bundled into the client.
2. **Keep the browser's built-in PDF reader (iframe).** Free, but the app cannot see or set which
   page is open and cannot place the pen on the page. Rules out the main goal.
3. **Convert PDFs to images on the server.** Needs a PDF tool on the Server PC and disk space per
   book; slower first open. No gain over 1.

## Design

### Contracts (`contracts/src/shows.ts`, `api.ts`)

- `Show` gains `kind: 'video' | 'pdf' | 'image' | 'whiteboard'`, `page: number` (1-based) and
  `pages: number | null` (known page count: whiteboard always, PDF once the teacher's app reports
  it, image 1). `item` becomes nullable (null for a whiteboard); `classId` and `className` stay.
- `ShowStart` becomes either `{ contentId }` (video, pdf, image) or `{ whiteboard: true, classId }`.
- New `PUT /api/v1/shows/:id/page` with body `{ page, pages? }` (teacher only). Moves every
  screen to that page. For a whiteboard, `pages` may grow by one to add a page (cap 30 pages).
  For a PDF, the teacher's app sends `pages` once after opening the file.
- `InkStroke` and the `add` `InkEvent` gain `page`. `InkAdd` gains `page`. `clear` gains `page`
  (the page being wiped).
- Video shows always use page 1.

### Server (`server/src/modules/shows/show.service.ts`)

- `start` accepts pdf and image items, and whiteboard (class checked with `seesClass`).
- Strokes are kept with their page. Limits: `INK_STROKES_MAX` (300) per page, and a new cap on
  lines per show (1,500).
- A student with the pen may write on a PDF, picture or whiteboard at any time; on a video only
  while paused (as today). A student may only write on the page the show is on.
- `clear` wipes the current page only. Video play/jump wipes as today.
- Ending, going quiet, the "still here" beat, replacing a show, the diary lines: unchanged.

### Teacher screen (`apps/client/src/features/content/Viewer.tsx`)

- "Show to Class" also appears for PDF and picture items.
- PDF is drawn by a new `PdfPages` component (pdf.js, worker bundled by Vite, works offline) with
  big Previous / Next buttons and "page 3 of 120". Turning the page calls the page endpoint while
  showing. The pen layer (`InkLayer`) sits on the page, sized to the page's shape.
- A **Whiteboard** button for teachers (in the content area), which asks which class, then opens a
  blank board with page buttons and "Add page".

### Student screen (`apps/client/src/features/shows/ClassShow.tsx`)

- Chooses what to draw by `show.kind`: video (as today), PDF page, picture, or blank whiteboard
  page. The student sees the page the teacher is on and the writing for that page only.
- Pen for the student who holds it, as today.

### Ink (`apps/client/src/features/shows/ink-board.ts`, `Ink.tsx`)

- The board keeps all lines with their page and draws only the lines of the current page.
  New lines are sent with the current page.

## Testing

- Server: unit tests for page moves, per-page writing, per-page wipe, limits, whiteboard start and
  class checks, student writing on a PDF without pause.
- Client: `ink-board` tests for page filtering. One end-to-end run in the browser harness: teacher
  shows a PDF, turns a page, writes; the student screen follows.

## Calls made after the builder check (Claude's calls, open to correction)

- **Where the new PDF reader is used:** on the teacher's Viewer (always, so the reader does not
  change when she presses Show to Class) and on the student's show screen. Students reading in
  My Books keep the built-in reader, so they keep its search and zoom.
- **Zoom:** no zoom in this version. Every screen shows the whole page. Following the teacher's
  zoom is later work.
- **Big books:** the user does not know book sizes, so pdf.js reads the PDF in parts through the
  same streaming address videos use (page 1 shows without downloading the whole book). If
  streaming fails on a PC, it falls back to downloading the whole file, as today.
- **Whiteboard shape:** fixed 16:9 on every screen, with plain bars where a screen is a different
  shape, so a line lands in the same place everywhere. In the contract as a constant.

## Left to the builder

- Exact look of the page buttons and the class picker, using the existing clay UI parts.
- How pdf.js is loaded (worker setup) and how pages are cached in memory.
