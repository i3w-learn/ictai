# The PRAXIS features we still lack: what we will build and how each one works

Date: 2026-11-24 · Status: draft, waiting for the user's yes

A web page of this file is next to it: `2026-11-24-praxis-gap-features-design.html`.

## Why

ICT App is meant to do everything PRAXIS does. A check of the code on 2026-11-24 found the PRAXIS
features that are still missing. The user chose which of them to build. This file says what each
one is, how it will work, and in what order we build them.

This is the map for all eight. Each feature still gets its own short design and the user's yes
before its code is written.

## What is done so far

Last changed: 2026-11-24.

| # | Feature | State |
|---|---|---|
| 1 | Lock policy | **Built and tested on the Mac.** Not yet tried on Windows. |
| 2 | Quiz: at your own speed, and teams | **Built and tested on the Mac.** Not yet tried on Windows. |
| 3 | Messages | Not started |
| 4 | Next steps | Not started |
| 5 | Lesson recording | Not started |
| 6 | Seeing a student's screen | Not started |
| 7 | Live lesson on the smart board | Waiting for the user's answer (open question 1) |
| 8 | Teacher app | Waiting for the user's answer (open question 1) |

### Feature 1, Lock policy: what was done

- **Built:** a switch on the System screen, "Lock the lab PCs when no class is booked in the lab".
  With it on, the server looks at the clock and the timetable every 15 seconds and locks or opens
  the lab PCs when a booked period starts or ends. A PC locked this way says "The lab is closed for
  now" (English and Marathi), not "Look at your teacher".
- **Tested by the computer:** 20 tests about this feature. The whole set (458 server tests, 125 app
  tests) passes, and was run three times in a row.
- **Tested on the real screens, on the Mac:** as Super Admin (turn the switch on), as a teacher (cannot
  reach the switch, can unlock by hand, and the unlock holds), and as a student (locked by the
  timetable before and after signing in). Seven steps, all passed. The report with pictures is
  `docs/test-reports/2026-11-24-lock-policy.html`.
- **Found by testing and fixed:** turning the switch on during a class, or off, used to open screens
  a teacher had locked by hand; and a PC locked by the timetable used to say a teacher had locked it.
- **Left as it is:** with two booked periods one after the other, a teacher's lock from the first
  carries into the second. If the `ICTServer` service restarts when no class is booked, a teacher's
  unlock by hand is lost.
- **Still to do:** run "Step 5a-2" and "Step 5a" of `docs/windows-test-guide.md` on two Windows PCs.
  Have a Marathi speaker read the one new Marathi sentence in `apps/client/src/i18n/mr.ts`.

### Feature 2, Quiz (practice and teams): what was done

- **Built, practice:** a teacher presses "Give as practice" on a quiz. The class finds it under Things to
  do, with no clock, and can try again as often as they like; the best finished try is kept. The last
  answer hands the try in by itself. The teacher sees each student's tries and best score live. Practice
  never counts for results or report cards. While practice is open the quiz's line says so and leads
  back to it; after it ends, "Practice scores" opens it again.
- **Built, teams:** when opening Lab Mode the teacher picks 2, 3 or 4 teams. Students are put in the
  smallest team as they join, and see their team's colour (Red, Blue, Green, Yellow). A team's score is
  the average of its members' scores. The teacher sees the teams' places live; a student sees them once
  done. Teams that are level share a place.
- **A child in practice can still be reached:** what the teacher shows the class, a live quiz and a poll
  come up over a practice quiz.
- **Tested by the computer:** 16 new tests. The whole set (474 server tests, 125 app tests) passes, and
  was run three times in a row.
- **Tested on the real screens, on the Mac:** as teacher, as student and as Super Admin. Sixteen steps,
  all passed. Report with pictures: `docs/test-reports/2026-11-24-quiz-practice-teams.html`.
- **Found by testing and review, and fixed:** an open practice was a trap (no sign of it on the list,
  and a wrong message on Edit); a child in practice could not be reached by the teacher; level teams
  were shown as first and second; a try was lost if the PC went off after the last answer.
- **Left as it is:** a team with one student shows that student's score to the class as the team's
  average. A student who joins and never answers counts as 0 in the team's average. With more teams than
  students, the empty teams are not listed. "Quizzes run" on the Teachers report counts practice too.
- **Different from the first plan:** the plan said the server would keep a "try number" per answer. It
  keeps one set of answers and the best score so far, which is simpler and enough.
- **Still to do:** steps 6-2, 6-3 and then 6 of `docs/windows-test-guide.md` on Windows PCs. A Marathi
  speaker should read the 18 new Marathi lines (practice, teams, the four colour names).

## What we build (in this order)

Small ones first, so something useful is finished early. Each one can be installed and used
without the ones after it.

| # | Feature | Size | New on the Windows side |
|---|---|---|---|
| 1 | Lock policy | Small | Nothing |
| 2 | Quiz: at your own speed, and teams | Medium | Nothing |
| 3 | Messages (teacher and student) | Medium | Nothing |
| 4 | Next steps for each student | Small | Nothing |
| 5 | Lesson recording | Medium | More disk used on the Server PC |
| 6 | Seeing a student's screen | Large | Takes pictures of the Windows screen. Cannot be tried on the Mac. |
| 7 | Live lesson on the smart board | Large | A new full-screen window |
| 8 | Teacher app | Not decided | A new choice in the installer |

## What we do not build

The user said no to these four:

- External activities (opening games installed on the PC)
- Device commands (restart app, reload, open content, re-key)
- Parents / Family mode
- Split screen

Claude suggests leaving out these three as well. The user has not yet said yes to this:

- **Cloud (licence, lockdown, shared library, app updates, daily totals).** The lab has no
  internet, so none of it can run.
- **Android board app.** The school's board is a Windows PC, installed with `ICT-Setup`.
- **Student PIN, QR card and enrolment code.** Sign-in by class and roll number was chosen on
  purpose, so young children can sign in by themselves.

## Rules for all eight

- Nothing needs the internet. Everything goes between the Server PC and the lab PCs on the
  school's own network, over the two ports that are already open (TCP 7700, UDP 7701). No new
  firewall rule.
- Nothing needs the Server PC to be on at night.
- New data goes into the same database file in `C:\ProgramData\ICT App\server\`, each change as a
  new numbered step, so an installed school is upgraded without losing anything.
- Live things (a message arriving, a lock, a screen picture) use the open line the app already
  keeps to the server. No second line.
- New student screens are written in English and Marathi.
- What goes between the server and the app is described once, in `contracts/`, and both sides use it.

## How each one works

### 1. Lock policy

**What it is.** Lab PCs lock themselves when no class is booked in the lab, and open when a class
is. Today a teacher has to press Lock and Unlock by hand.

**What we already have.** The periods of the day, the timetable (which class has the lab in which
period), and the lock itself ("Look at your teacher").

**How it works.**

1. The Super Admin turns on one switch in System: "Lock the lab PCs when no class is booked".
2. Every 15 seconds the server looks at the clock and the timetable.
3. No class booked right now: every lab PC is locked. A class is booked: they are opened.
4. A teacher can still lock or unlock by hand. What she does holds until the next period starts
   or ends; then the timetable decides again.

The switch is saved in the database. The locks themselves stay in memory, as today, so a PC is
never found locked in the morning because of yesterday.

Two more rules. If the timetable is empty, the switch does nothing, so a new school is not locked
out before it has filled its timetable. Sunday has no lab periods, so with the switch on the lab
PCs are locked all Sunday.

**Status: built on 2026-11-24, tried on the Mac only.** Plan: `docs/superpowers/plans/2026-11-24-lock-policy.md`.

### 2. Quiz: at your own speed, and teams

**At your own speed.** Today a quiz runs only live: the teacher opens it and every student answers
the same question on the same clock.

1. The teacher picks a quiz and presses "Give as practice", and picks the class.
2. Each student finds it under Things to do, and answers the questions one at a time with no clock.
3. The score is saved when the student finishes. The student may try again; the teacher sees the
   best try.
4. Practice scores are shown to the teacher but are not used for report cards (the same rule as
   activities).

**Teams.** For a live quiz.

1. When the teacher opens the quiz she picks "Teams" and how many (2, 3 or 4).
2. As students join, the server puts them into teams so the teams are the same size. Each student's
   screen shows their team's colour.
3. A team's score is the average of its members' scores, so a team with one more student gets no
   head start.
4. The teacher's screen shows the teams' places. Each student still gets their own score as today.

In the database: a quiz run gains "live or practice" and "number of teams"; a student in a run
gains "team".

### 3. Messages (teacher and student)

**What it is.** A teacher and a student write short notes to each other. A notice goes to a whole
class; a message is between two people.

1. A teacher opens a student and writes. A student opens "Messages" on Home, picks one of their
   teachers and writes.
2. Text only, up to 500 letters. No files, no pictures.
3. If the other person is signed in, the message appears at once. If not, it waits on the server
   and a number shows on their Home the next time they sign in.
4. A student can write only to teachers of their own class. Students cannot write to students.
5. The Super Admin can read every message, and both screens say so. This is for the children's
   safety.

In the database: one new table of messages (who, to whom, the text, when, when it was read).

### 4. Next steps for each student

**What it is.** Up to three plain suggestions for each child, such as "Watch: Fractions, part 2" or
"Hand in: Science worksheet". Worked out with simple rules. No AI, so it works on a server with no
AI kit.

**The rules, in this order.**

1. Work that is set and not handed in, nearest hand-in date first.
2. A playlist or learning path that is started and not finished: its next step.
3. The subject with the lowest quiz results (under half marks): a library item of that subject and
   chapter that the student has not opened.
4. An activity for the student's class that they have not tried.

The server works this out from what it already keeps, each time it is asked. Nothing new is saved.
The student sees it on Home. The teacher sees it when she opens that student.

### 5. Lesson recording

**What it is.** A lesson shown with "Show to Class" can be kept and played again later. We do not
save video or sound. We save the **steps** of the lesson.

**How it works.**

1. In a show, the teacher presses "Record".
2. From then on the server writes down every step with its time from the start: which file was
   opened, each page turn, each play, pause and jump of a video, each pen line, each wipe.
3. When the show ends, the recording is closed and given a name (class, subject, date).
4. Later, the teacher or a student of that class opens "Past lessons" and presses play. The app
   opens the same file and does the same steps at the same times. The pen lines draw themselves
   again.

**Why steps and not video.** An hour of steps is smaller than one photo. An hour of video is
hundreds of megabytes and would fill the Server PC's disk in a term. The price: the teacher's
voice is not kept.

**Windows.** The file that was shown must still be in the library when the lesson is played. A
library item used by a recording cannot be deleted until the recording is deleted; the app says so.
Recordings older than a number of days the Super Admin sets (90 to start) are removed.

### 6. Seeing a student's screen

**What it is.** The teacher looks at what is on one student's PC, live.

1. The teacher picks a student who is signed in and presses "See screen".
2. That student's PC at once shows a banner that cannot be closed: "Your teacher is looking at
   your screen". This rule has no exceptions: no banner, no pictures.
3. The student PC takes a small picture of its screen about every two seconds and sends it to the
   server, which passes it straight to the teacher.
4. The pictures are never saved, on any PC. When the teacher closes the view, the pictures stop
   and the banner goes.
5. A teacher can watch only students of her own classes. Each time is written in the activity log.

**The trade-off.** A picture every two seconds, not smooth video. Smooth video from 60 PCs would
fill the school network and slow the lesson. A picture every two seconds is enough to see what a
child is doing. If a PC or the network is slow, old pictures are thrown away, so the teacher sees
a slightly old picture and the server's memory stays small.

**Windows.** Taking a picture of the screen is done by the Windows part of the app, not the page.
That part cannot be built or run on the Mac. It will be written on the Mac, built by GitHub, and
is only proven when it is tried on two real Windows PCs.

### 7. Live lesson on the smart board

**What we know.** The board design of 2026-11-19 says the teacher plugs the Server laptop into the
board (HDMI for the picture, USB for touch) and teaches there. So today the board shows the whole
console, with its menus and small buttons.

**What we build (Claude's proposal).** A board window: a clean, full-screen window for teaching,
opened from the console with one button.

1. It shows only the lesson: the PDF, picture, video or whiteboard, as large as the board.
2. Big buttons for a finger: next page, previous page, pen, eraser, wipe, add page, end.
3. No student lists, marks or menus are on the board for the class to read.
4. A live quiz can be shown too: the question in large letters, and the places at the end.
5. Everything it shows goes to the student PCs the way "Show to Class" does today.

If the school also has a board with its own Windows PC (installed as "Smart board"), that PC shows
the same window by following the class's show over the network. This depends on the open question
below.

### 8. Teacher app

In PRAXIS the teacher has her own app on a tablet or laptop and drives the board from anywhere in
the room. Whether we need this depends on the open question below. If teachers only use the Server
PC, there is nothing to build: the console is the teacher's app.

If they do have their own PCs: the installer gets one more choice, "Teacher PC". It shows the same
teacher screens as the Server PC, and talks to the server over the school network like a lab PC does.

## Under the hood

### The four building blocks we already have

Every feature below is made from these. None of them needs a new kind of part.

1. **Ask and answer.** The app asks the server for something over HTTPS on port 7700. On the server
   a request goes through three layers: the *route* (checks who is asking and what they sent), the
   *service* (the rules), the *repository* (reads and writes the database file).
2. **Rooms on the open line.** Each app keeps one line open to the server (`server/src/relay/`).
   On it, the app joins named "rooms": `device:<PC>` for its own lock, `show:<class>` for the class
   show, `quiz:<run>` for a live quiz, `poll:<class>`. When something changes, the server tells
   everyone in that room. Each room has a rule for who may join.
3. **Timers on the server.** `server/src/main.ts` already runs small jobs every few seconds (for
   example, ending a show that went quiet).
4. **The Windows part of the app.** The screens are a web page inside a small Windows program
   (`apps/client/src-tauri/`, written in Rust). The page asks that program for things a web page
   is not allowed to do: finding the server, keeping files, the open line.

### 1. Lock policy

- **Database:** one new setting, "lock when no class is booked", next to the other System settings.
- **Server:** a new small class, `LockPolicy`, run by a 15-second timer. It reads today's periods
  and the timetable and answers one question: "should the lab be locked right now?"
- It acts **only when that answer changes** (a period starts or ends). Then it calls the lock code
  we have (`ScreenLocks`), which tells each PC through its `device:<PC>` room. This is why a
  teacher's lock or unlock by hand holds until the next change.
- **App:** one switch on the System screen. The lab PCs need no new code; they already obey the lock.

### 2. Quiz: at your own speed, and teams

- **Database:** `quiz_runs` gains `mode` (live or practice) and `teams` (0, 2, 3 or 4).
  `quiz_participants` gains `team` and a try number.
- **Practice:** the server makes a run with `mode = practice`. The same "answer" request is used as
  in a live quiz; the service skips the clock check for practice runs. No room is needed, because
  nobody is watching live. The results rules (`modules/results/rules.ts`) leave practice runs out
  of report cards.
- **Teams:** when a student joins, the run service puts them in the team with the fewest members
  and saves it. Team places are worked out from the answers we already save, and sent with the
  rest of the quiz state in the `quiz:<run>` room.
- **App:** a "Give as practice" button and a teams picker for the teacher; a practice player for
  the student that reuses the question screen of the live quiz without the clock.

### 3. Messages

- **Database:** a new `messages` table: id, student, teacher, who wrote it, text, written at, read at.
- **Server:** a new `messages` module (routes, service, repository), built like `notices`. Requests:
  list my conversations, read one, write one, mark as read. The service checks that the teacher
  teaches that student's class, with the same rule used everywhere else.
- **Live:** a new room, one per person (their inbox). Writing a message saves it first, then tells
  the other person's inbox room. If they are not signed in, nothing is lost: the message is in the
  database and is fetched at their next sign-in.
- **Super Admin:** a read-only request for any conversation, written to the activity log each time.

### 4. Next steps

- **Database:** nothing new.
- **Server:** a new service in the `results` module. It reads from repositories we have (work,
  playlists and their done steps, quiz results, the library, activity results) and puts them
  through one plain function that holds the four rules. A plain function is easy to test: data in,
  three suggestions out.
- **Requests:** "my next steps" for a student, and "next steps of this student" for a teacher.
- **To check in this feature's own design:** how well the server knows which library items a
  student has opened. Rule 3 depends on it.

### 5. Lesson recording

- **Database:** `recordings` (class, subject, teacher, start, end) and `recording_events`
  (recording, time from the start in milliseconds, kind of step, its details).
- **Server:** every change to a show already goes through one place, `ShowService` (start, page,
  play and pause, pen, stop). A new `Recorder` is called from those same spots and writes a row.
  A pen line is saved once, when it is finished, not point by point.
- **If the Server PC is switched off mid-lesson:** on the next start the server closes any
  recording left open, at the time of its last step.
- **Playing back is done by the app, not the server.** The app fetches the list of steps and walks
  through it with a clock, feeding each step into the same drawing code that a live show uses. So
  there is one player, not two, and a recording looks exactly like the lesson did.

### 6. Seeing a student's screen

- **Start:** the teacher's app sends "watch this PC". The server checks the class, writes the
  activity log, remembers "teacher T watches PC P" in memory, and adds `watched: true` to what it
  tells that PC in its `device:<PC>` room, the same room that carries the lock.
- **Student PC:** on `watched: true` the page shows the banner first, then asks the Windows part
  for a picture. The Windows part (new Rust code) takes the picture, makes it smaller (about 960
  dots wide) and packs it as a JPEG of roughly 50 to 150 KB.
- **Passing it on:** the picture goes up the open line. The server hands it only to the teacher
  who is watching, and keeps no copy. If the teacher's line is still busy with the last picture,
  the new one is dropped.
- **Stop:** the teacher closes the view, or her line drops, or the student signs out. The server
  forgets the pair and tells the PC `watched: false`; the banner goes and the pictures stop.
- **New:** one Rust library for taking a screen picture on Windows, and a larger size limit on the
  open line for picture messages only.

### 7. Live lesson on the smart board

- **The Windows part** opens a second window, with no frame, full screen on the second display
  (the board on HDMI). The console stays on the laptop's own screen.
- **The page in that window** is the same app, started in a "board" layout: only the lesson and
  the big buttons.
- **Keeping the two windows in step needs no new wiring.** Both windows talk to the server, and
  both are in the `show:<class>` room. A page turn on the board goes to the server and comes back
  to the console and to every student PC the same way.
- **A board with its own PC:** the room's joining rule is widened so a board linked to a class may
  follow that class's show.

### 8. Teacher app

- **Installer:** one more choice, "Teacher PC".
- **App:** the console screens, but finding the server over the network (UDP 7701) the way a lab
  PC does, and not expecting the server on the same PC.
- **To check:** that the server lets staff sign in from another PC today, and not only from itself.

## Open questions for the user

1. **Do teachers have their own laptop or tablet in the lab, or do they teach only from the Server
   PC plugged into the board?** This decides whether feature 8 exists, and what feature 7 has to do.
2. **Is leaving out the cloud, the Android board app and the student PIN right?**

## Testing

- Every feature gets server tests and one run in the browser on the Mac.
- Features 1 to 5 use nothing that is special to Windows. They still need one run on real Windows
  PCs before a school uses them.
- Feature 6 can only be proven on Windows.
- `docs/windows-test-guide.md` gets new steps with each feature, and each feature's own design will
  name the old steps to run again.

## Approaches considered

1. **One feature at a time, small ones first (picked).** Each is designed, built, tried and
   installable before the next starts. A problem in one does not hold up the others.
2. **All eight in one go.** Faster to start, but nothing can be tried on Windows until all of it
   is done, and a mistake found late touches everything.
3. **The biggest first (board, screens).** These are the ones a visitor notices, but they are the
   ones that can only be proven on Windows, so the first weeks would show nothing finished.
