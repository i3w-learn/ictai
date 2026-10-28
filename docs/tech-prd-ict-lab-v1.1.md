# Technical PRD: Offline-First ICT Lab Classroom Platform

**Version 1.1 (Draft)** · 23 October 2026 · Rishabh Dhiman, Product Manager
Internal: development team only. Companion to the product PRD v0.4.

---

## 1. Scope and Constraints

This document tells the development team what to build and how the parts fit together: applications, roles, every feature with its technical notes, data, protocols and interfaces. The choice of languages, frameworks, databases and tools is left to the tech team.

- Windows 10 (22H2) and Windows 11, 64-bit only. No Android, iOS or web clients.
- Every school feature works with no internet. Internet is used only for cloud check-in, downloads and analytics upload.
- Student learning data never leaves the server machine. Only application analytics go to the cloud.
- One ICT lab per school: one server machine (optionally connected to a smart board by HDMI) and up to 60 lab PCs.
- P0 = first pilot, P1 = general release, P2 = later.

## 2. Applications

| Application | Runs on | Components | Users |
|---|---|---|---|
| Server app | The lab's main Windows PC (wired) | **Server service** (runs from boot as a Windows service): REST API, real-time relay, discovery beacon, background jobs, local database and file store, AI gateway. **AI runtime** (separate local process, localhost only). **Console** (desktop window on the server monitor). **Present window** (optional, full-screen on the HDMI display). | Super Admin, Teachers |
| Student app | Each lab PC | Desktop client with local cache and offline outbox; connects to the server over the lab LAN. | Students |
| Cloud platform (internal) | Our hosting | School registry with internal admin UI, licence service, check-in API, content and update store, USB kit builder, analytics ingest and warehouse. | Tech team only |

One installer for Windows; the first screen asks Server or Student. The console and Student app share one UI codebase with two builds.

```
 SERVER MACHINE (ICT lab)                               LAB PCs (up to 60)
 +-----------------------------------------------+      +------------------+
 | Server service (Windows service)              | LAN  | Student app      |
 | - REST API              TCP 7700              |<---->| local cache +    |
 | - Real-time relay       TCP 7700 /relay       |      | offline outbox   |
 | - Discovery beacon      UDP 7701              |      +------------------+
 | - Jobs, AI gateway, database, file store      |
 | AI runtime (local process, localhost only)    |
 | Console window (connects to localhost:7700)   |==HDMI==> Present window
 +-----------------------------------------------+          (optional)
                      | outbound HTTPS only, when online
                      v
 CLOUD: registry | licence | check-in | content & updates | analytics
```

- The service owns all data and logic; console and Student app are thin clients over REST + WebSocket.
- The console is a separate process, so closing or crashing it never stops the server.
- The cloud never connects into a school; all cloud traffic is started by the school server.

## 3. Roles and Permissions

| Role | Who | Signs in on | Credential | Session |
|---|---|---|---|---|
| Super Admin | Our field person, on-site | Console | Username + password from the signed field-person list (USB kit / check-in); works offline | 15 min idle timeout |
| Teacher | School teachers, all equal | Console | Username + password created by the Super Admin; stored hashed | 15 min idle; "Switch teacher" ends it |
| Student | Students | Student app | Class + name + 4-digit PIN, or printed QR card | Ends at sign-out, lesson end, 10 min idle |
| Lab PC (device) | - | - | Device token from the enrol window | Long-lived; revoked on retire |

Permissions are defined once as keys, checked by the server on every REST route and every relay message, and used by the UI to hide items.

| Permission key | Super Admin | Teacher | Student |
|---|---|---|---|
| `staff.manage` (add, edit, delete teachers) | Y | - | - |
| `students.manage` (add, edit, delete in any class; import; PIN cards) | Y | Y | - |
| `setup.*` (devices, master data, content, timetable) | Y | Y | - |
| `teaching.*` (quizzes, playlists, paths, week ahead, work, activities, recordings, notices, study rooms, Together monitor) | Y | Y | - |
| `lesson.start` / `lesson.control` / `lesson.present` | Y | Y | - |
| `results.view` (quiz results, marks, student analytics, reports, report cards) | Y | Y | own only |
| `ai.teacher` / `ai.tutor` | Y/- | Y/- | -/Y |
| `licence.view`, `updates.view` | Y | Y | - |
| `licence.renew`, `updates.install`, `settings.*`, `server.manage` | Y | - | - |
| Cloud application analytics | - | - | - (tech team only, outside the app) |

Student PIN lockout: 5 failures, 5 minutes. Sign-in endpoints rate-limited per device.

## 4. Feature Specifications: Server Console

All console features are available to the Super Admin and Teachers unless marked otherwise.

### 4.1 Overview and people

| Feature | Pri. | What it does | Technical notes |
|---|---|---|---|
| Overview | P0 | Today's planned and live lessons, lab PCs connected, students signed in; alerts (PCs offline, disk low, licence expiring, no check-in 14+ days); footer "Serving the lab" + last check-in | `GET /server/status`; push updates on relay channel "system" |
| Students | P0 | Add, edit, delete in any class; import Excel/CSV; move section; promote class; print PIN/QR cards; reset PIN | Soft delete; duplicate check (name + class + roll); cards rendered to PDF; import validates per row and returns an error report |
| Staff (Super Admin only) | P0 | Add, edit, delete teachers; reset password | Delete = status deleted + revoke sessions; content stays with the school |

### 4.2 Lab setup

| Feature | Pri. | What it does | Technical notes |
|---|---|---|---|
| Devices | P0 | Register lab PCs via a 30-min enrol window; list status, last seen, version; rename, retire; lock, unlock, restart app, "look at the front" | Commands sent over relay with per-device ack; quota from licence |
| Master data | P0 | Classes, subjects, languages from the profile; school names sections and sets period times | Profile-owned fields read-only; school fields editable |
| Content | P0 | Library of PDF, images, video, audio, slides, HTML5 packages, video links; filed by class, subject, chapter | Upload max 512 MB, streamed, type sniffing; content-addressed by SHA-256 and de-duplicated; links flagged `needs_internet`; text extracted and indexed for AI |
| Timetable | P1 | Weekly lab grid by period with clash checks | Drives week ahead, student Today and reminders |

### 4.3 Teaching and assessment

| Feature | Pri. | What it does | Technical notes |
|---|---|---|---|
| Quizzes & polls | P0 | Kind quiz or poll; title, class, subject, seconds per question (0 = teacher moves on); question types single, multiple, true/false, image, number, short text; poll types choice, rating, word cloud; live run with countdown, tally, reveal, leaderboard (switchable), team mode (P1); self-paced as work; Generate with AI | Live run over relay (`quiz.*` events, server-timed countdown); answers acked and accepted if client timestamp is before close; polls never scored |
| Playlists | P1 | Ordered videos, links, PDFs, activities for a chapter; played in Present mode or sent to lab PCs | `needs_internet` items skipped when offline |
| Learning paths | P1 | Steps watch, read, activity, quiz check, assignment; optional prerequisites; Draft from the library (AI) | Step completion recorded per student for results |
| The week ahead | P1 | Mon-Sun grid; plan a lesson per slot (content, playlist, path step, quiz); reminder 5 min before | Reminder job pre-loads planned files to the class's lab PCs |
| Plan a lesson (AI) | P0 | Topic, class, subject, minutes (default 40) to objectives, timed steps, library items, checks, homework; edit or regenerate parts; save to week ahead or open in Present mode | Structured AI output (Section 9); "AI is not installed" state if no model |
| Work | P0 | Assignments from quiz, worksheet, file task or library item; due date, marks; teacher marks with comments | Submissions: text, file, drawing, webcam photo; append-only; late flag |
| Activities | P0 | Offline interactive packages, Anganwadi to Class 12 | Packages run sandboxed; report score, time, completion to the server through a message API |
| Recorded lessons | P1 | Record Present-mode screen and audio (no camera); replay from My books | Recording stored on the server file store; deletable by teachers |
| Notices | P1 | One-way notices by school, class or section; pin, expiry | Shown in Student app |
| Study rooms | P1 | Teacher-run group space with whiteboard and selected content | Relay room type `study` |
| Together monitor | P1 | See open Together rooms and members; join, watch, close | Relay room type `together`; teacher joins read-only or with pen |

### 4.4 Results and insights (in school only)

| Feature | Pri. | What it does | Technical notes |
|---|---|---|---|
| Quiz results & marks | P0 | Results of live quizzes and marked work per student and class; export Excel/PDF | Never included in analytics upload |
| Student analytics | P1 | Per student and class: attendance, lessons joined, accuracy by subject/chapter, work on time, path progress, weakest chapters | Computed on the server from local tables |
| Reports | P1 | Lab usage, attendance and assessment summaries; export | Local only |
| Report cards | P1 | Generated from marks; teacher remarks; draft, published, frozen; PDF print | Frozen cards are immutable snapshots |

### 4.5 System

| Feature | Pri. | What it does | Technical notes |
|---|---|---|---|
| Licence | P0 | School ID, valid until, PCs allowed, last check. Teachers view; Super Admin renews online or by file | Signed licence token verified offline; 30-day grace, extended by renewal files |
| Updates | P0 | Installed and available versions with notes. Teachers view; Super Admin installs, rolls back, imports update kit, sets policy | Never install during a live lesson |
| Settings (Super Admin) | P0 | School name, logo, periods, student sign-in method, AI feature switches, Together on/off, backup location | |
| Server manager (Super Admin) | P0 | Relay status, lab PCs connected and "could not reach", cloud check-in and upload backlog, content on disk, network addresses, AI engine status; check in now, export analytics to USB, fetch content, restart relay/AI | Addresses list excludes virtual adapters; connection file export |

### 4.6 Present mode (not mandatory)

- Used only when a smart board, projector or TV is connected to the server machine by HDMI. Without it, lessons run from the console and the teacher reads the join code aloud.
- Extended display: Present window full-screen on the external display; console stays on the server monitor. Single screen: Present full-screen with a floating control bar.
- Shows: idle screen (school, period, clock, next lesson), content, join code (hideable), quiz countdown and results, whiteboard, playlist steps, Ask AI output (P1).
- Controls on the console: next/previous, play/pause, annotate, whiteboard, quiz/poll start and reveal, blank, lock lab PCs, show/hide code, end lesson; keyboard shortcuts and USB touch.
- Present window renders only presentation routes; never student lists, results or settings.

## 5. Feature Specifications: Student App

| Feature | Pri. | What it does | Technical notes |
|---|---|---|---|
| Sign-in | P0 | Pick class, tap name/photo, enter PIN; or scan QR card with webcam | Session bound to device token |
| Today | P0 | Greeting, current lab period, Join the lesson (6-digit code), live-lesson card (P1), shortcut cards | Wrong code: "not running in your class"; expired: "lesson has ended" |
| In-lesson view | P0 | Follows the teacher's screen or free mode; answers quizzes and polls; draws when given the pen; private notes; raise hand, "I'm stuck"; locked/blanked on command | Relay events; answers through outbox with ack |
| My books | P0 | Books and library items for the class by subject and chapter; recorded lessons; reading position remembered | Cached locally (LRU, 10 GB cap) |
| Things to do | P0 | Activities, playlists and path steps for the class, with done ticks and next step | |
| My work | P0 | To do, submitted, marked; submit text, file, drawing, webcam photo; see marks and comments | Works offline through the outbox |
| How I am doing | P1 | Own attendance, lessons joined, work on time, accuracy by subject, path progress, "try this next" | Student sees only own data |
| Notices | P1 | Notices for the class, newest first | |
| Together | P1 | Start a room (get code) or join by code; shared whiteboard (pen, shapes, text, sticky notes, library images); up to 6; saved to My work; banner "teacher can see this room" | Whiteboard only, no chat or voice; same class by default; close after 60 min idle; switchable by Super Admin |
| Ask (AI tutor) | P1 | Typed questions answered from the school's books with citations; hints, not assignment answers | Scope limited to the class syllabus; daily cap setting |
| Settings | P0 | Language, text size, high contrast, dyslexia-friendly font, sign out | WCAG 2.1 AA |
| Status chip | P0 | "Connected", "Reconnecting...", "Working offline: N answers waiting" | |

## 6. Server Service

### 6.1 Startup

1. Service starts at boot, auto-restarts on failure.
2. Single-instance lock; opens database, runs migrations, verifies licence.
3. Binds TCP 7700 on private interfaces and UDP 7701. If 7700 is busy, shows the owning program in the console.
4. Starts the AI runtime process if models are installed (lower priority, restarted on crash).
5. Starts jobs; the console connects to `localhost:7700`.

### 6.2 Background jobs

| Job | Schedule | Action |
|---|---|---|
| Check-in | Every 15 min if online | Heartbeat to cloud; process returned actions (Section 10) |
| Downloads | After check-in | Content, updates, models; resumable; verify checksum and signature |
| Analytics | Nightly roll-up; upload after check-in | Seal batches; upload oldest first; throttled in school hours |
| Backup | Nightly | Database + file-store manifest to backup folder; keep 7 |
| Indexing | On content change | Extract text, chunk, embed, store vectors |
| Reminders | Every minute | Lessons starting in 5 min: notify console, pre-load files |
| Cleanup | Nightly | Expire codes, close idle rooms, purge AI prompts > 90 days, prune unsent analytics > 180 days |

### 6.3 Windows integration

- Installer adds firewall rules for TCP 7700 and UDP 7701 (Private profile); warns on Public networks.
- Secrets (school key, licence) protected with Windows machine-level encryption.
- Licence bound to the primary physical network adapter; virtual adapters ignored.

## 7. Data Model

Local database on the server machine. UUID keys; UTC timestamps; soft delete for users and students; version column on records edited during lessons.

| Area | Entities |
|---|---|
| School & config | school (school_id, name, udise, profile), settings, licence, field_person_accounts |
| People | users (role super_admin \| teacher, username, password_hash, status), students (name, class, section, roll_no, gender, dob, pin_hash, qr_token), classes, sections, subjects, periods |
| Devices | devices (name, token_hash, last_seen, app_version, status), enrol_windows |
| Content | content_items (type, class, subject, chapter, needs_internet, file hash), files (sha256, size, mime), content_chunks, content_vectors |
| Teaching | quizzes (kind quiz \| poll, seconds_per_q), questions, playlists, playlist_items, paths, path_steps, timetable_slots, planned_lessons, activities, notices, recordings |
| Live | lessons (room_id, join_code, started_by, status), participants, quiz_runs, answers, whiteboards, together_rooms, study_rooms |
| Work & results | assignments, submissions, marks, attendance, path_progress, report_cards (draft \| published \| frozen) |
| AI | ai_requests (feature, role, latency, status, prompt, output; text purged after 90 days) |
| Analytics & sync | app_events, app_daily, upload_batches, sync_state, download_queue |

## 8. LAN Networking and Real-Time Protocol

### 8.1 Discovery

```
Client -> broadcast UDP 7701 : {"t":"discover","v":1,"app":"student","ver":"1.0.3"}
Server -> reply              : {"t":"here","v":1,"schoolId":"SCH-0007","name":"ZP Walni",
                                "addrs":[{"ip":"192.168.1.51","if":"ethernet"},
                                {"ip":"192.168.1.6","if":"wifi"}],"port":7700}
```

- Client tries each address with `GET /health` (same schoolId), 2 s timeout; caches the winner; re-discovers only on failure.
- Retry every 3 s for 10 s, then manual IP or a connection file from USB; mDNS as fallback.
- Server records PCs that discover but never connect (shown in Server manager).

### 8.2 Real-time relay

WebSocket at `ws://<server>:7700/relay` with the session token. One connection per client; rooms joined by message.

```
{"t":"<type>","room":"<roomId>","seq":1042,"ts":1729650000123,"id":"<uuid>","p":{...}}
 seq = server order per room   ts = server clock   id = client message id (de-dup)
```

| Group | Message types |
|---|---|
| Session | hello, ping/pong (clock sync), join, leave, state (full snapshot), error |
| Navigation / media | nav.open, nav.page, nav.scroll, playlist.next, media.play, media.pause, media.seek |
| Ink | ink.stroke (batched 50 ms), ink.clear, ink.pen |
| Assessment | quiz.start, quiz.question, quiz.tick, quiz.answer, quiz.ack, quiz.reveal, quiz.board, poll.result |
| Control | ctl.lock, ctl.unlock, ctl.blank, ctl.attention, lesson.end |
| Student signals | hand.raise, hand.stuck, presence |
| AI / system | ai.chunk, ai.done, system.status |

- Role and room membership checked on every message; frames over 64 KB rejected (large data via REST).
- Slow clients: drop non-critical frames and send a fresh state snapshot instead of queueing.
- Critical writes (answers, attendance, submissions) acked; clients resend from the outbox until acked.
- Reconnect backoff 1, 2, 4 ... 30 s; rejoin and receive state.
- Join codes: 6 digits, unique among open rooms, expire with the room; wrong-code attempts rate-limited.
- Latency targets: navigation/control < 300 ms p95 to 60 PCs; ink < 200 ms; media screens within 500 ms.

## 9. Offline AI

```
Console / Student app --REST--> AI gateway (in server service)
                                 - permission and feature-switch check
                                 - priority queue: live lesson > teacher > student
                                 - retrieval: embed query -> top-k library chunks
                                 - prompt template per feature, structured output
                                       v
                         Local AI runtime (localhost only)
                         quantised open LLM + embedding model + translation model
```

| Feature | Endpoint | Output |
|---|---|---|
| Lesson plan generator | `/ai/lesson-plan` | objectives[], steps[{minutes, activity, contentIds[]}], checks[], homework |
| Quiz & worksheet generator | `/ai/quiz` | questions[{type, text, options[], answer}] saved as draft quiz |
| Ask the library | `/ai/ask` | Streamed answer + citations[{contentId, page}] |
| Draft learning path | `/ai/path-draft` | steps[{type, contentId}] from existing chapter items |
| Student tutor | `/ai/tutor` | Streamed hints limited to the class syllabus |
| Translate & simplify | `/ai/translate` | Translated or simplified text (Hindi and other Indian languages) |
| Present-mode Ask AI | `/ai/ask` (lesson priority) | Streamed to the Present window via relay |

- Open models with licences that allow government and commercial use; selected by the tech team through benchmarking.
- Model package: model files + signed manifest (name, version, checksum, recommended settings); delivered by USB kit or cloud.
- Install detects CPU, RAM and GPU and configures the runtime accordingly.
- Indexing: text extracted from library items, chunked with overlap, embedded, stored with content id and page.
- Limits: one request per user at a time, student daily cap, 120 s timeout; queue position returned.
- No model installed: `/ai/*` returns `AI_NOT_INSTALLED` and the UI shows the empty state.

## 10. Cloud Services and Sync

| Service | Responsibility |
|---|---|
| School registry + admin UI | Schools (School ID, UDISE+, district, state, profile, PC quota, field person, status), profiles, field people; internal UI behind company sign-in |
| Licence service | Signed licence tokens; offline activation and renewal files |
| Check-in API | Receives heartbeats, returns pending actions |
| Content & update store | Content packs, signed app builds, AI model packages, signed manifests; CDN delivery |
| Kit builder | Builds the USB kit for a school from the registry |
| Analytics ingest + warehouse | Validates and stores application analytics; tech team's BI tool reads it |

### 10.1 Identity and signing

- Activation gives the server its School ID and licence; the server generates a key pair locally and registers the public key.
- Every cloud request carries School ID, timestamp and a signature over the request; the cloud rejects unknown keys and clock skew over 10 minutes.
- HTTPS with certificate pinning to our certificate authority.

### 10.2 Check-in contract

```
POST /v1/checkin
{ "schoolId":"SCH-0007", "ver":{"server":"1.0.3","student":"1.0.3","models":"2026.10"},
  "health":{"uptimeH":212,"diskFreeGb":118,"pcsOnline":34,"backlogBatches":3},
  "manifests":{"content":"<hash>","profile":"<hash>","fieldPeople":"<hash>"} }

200 { "licence":"<signed token|null>", "uploadAnalytics":true,
      "actions":[{"type":"download","kind":"content","manifest":"<url>"},
                 {"type":"update","kind":"app","version":"1.0.4","policy":"after-hours"},
                 {"type":"fieldPeople","bundle":"<signed>"},{"type":"profile","bundle":"<signed>"}] }
```

- Licence token: signed {schoolId, adapter hash, pcQuota, validUntil, graceDays}; verified offline.
- Downloads listed in signed manifests (path, size, checksum); resumable; verified before use.
- Field-person bundle: signed list {username, password hash, active}; replaces the local list atomically.

### 10.3 USB kit

```
KIT-SCH-0007-2026-10-23/
  kit.json           signed manifest of everything below
  installer/         signed installer
  activation.lic     signed activation (schoolId, licence, cloud public key)
  profile.json       signed profile (master data, settings, update policy)
  field-people.json  signed field-person list
  content/ models/   packs + manifests
  returns/           server writes analytics exports here
```

Import verifies all signatures and checksums, then applies: activation, profile, field people, content, models, app update.

## 11. Application Analytics Pipeline

> **Hard rule:** analytics events never contain a person or learning data. The collector accepts only allow-listed fields and rejects anything else; covered by an automated test.

```
{"e":"lesson.presented","ts":"2026-10-23T09:05:11Z","schoolId":"SCH-0007","app":"server",
 "ver":"1.0.3","role":"teacher","dims":{"class":"7","subject":"science"},
 "m":{"minutes":38,"pcsJoined":32}}
```

| Field | Allowed values |
|---|---|
| e | Catalogue event: lesson.presented, quiz.run, poll.run, work.set, content.opened, playlist.used, path.used, together.opened, ai.request, signin.count, pc.online, app.crash, sync.checkin, ... |
| ts, schoolId, app, ver | Time (UTC), school, app, version |
| role | teacher \| student \| super_admin \| system (never a user id) |
| dims | class, subject, contentId, feature, windowsVersion, errorCode |
| m | Numbers only: counts, minutes, latency, sizes |

- Never allowed: names, usernames, user or student IDs, scores, marks, attendance, answers, free text, prompts.
- Raw events kept up to 180 days unsent; nightly daily totals never pruned before upload.
- Upload: compressed batches (~1 MB) with batch id and checksum, signed; cloud idempotent on batch id.
- No internet: Super Admin exports signed batches to the kit `returns/` folder; tech team uploads via admin UI.
- Warehouse joined to the registry by School ID; tech team BI tool has read-only access.

## 12. REST API (LAN)

Base `http://<server>:7700/api/v1`. JSON with schema validation; errors `{code, message}`; cursor pagination; uploads streamed, max 512 MB. An API contract (OpenAPI) is generated and shared by server and UI.

| Group | Main endpoints |
|---|---|
| System | `GET /health`, `/server/status`; `POST /server/checkin-now`, `/server/export-analytics`, `/kits/import` |
| Auth | `POST /auth/staff`, `/auth/student`, `/auth/switch`, `/auth/logout` |
| People | `/staff` (Super Admin); `/students`, `/students/import`, `/students/cards.pdf` |
| Setup | `/classes`, `/sections`, `/subjects`, `/periods`, `/devices`, `/devices/enrol-window`, `/devices/:id/command`, `/timetable` |
| Content | `/content`, `/content/upload`, `GET /files/:hash` (range requests) |
| Teaching | `/quizzes`, `/quizzes/:id/questions`, `/playlists`, `/paths`, `/planned-lessons`, `/assignments`, `/submissions`, `/marks`, `/activities`, `/recordings`, `/notices` |
| Live | `POST /lessons` (roomId, joinCode), `/lessons/join`, `/lessons/:id/end`; `/together-rooms`, `/study-rooms` |
| Results | `/results/quizzes`, `/results/students/:id`, `/analytics/class/:id`, `/reports`, `/report-cards` |
| AI | `/ai/lesson-plan`, `/ai/quiz`, `/ai/ask`, `/ai/path-draft`, `/ai/tutor`, `/ai/translate` |
| Licence & updates | `GET /licence`, `POST /licence/renew-file`, `GET /updates`, `POST /updates/install`, `GET /updates/student` (lab PC self-update) |

## 13. Non-Functional Targets and Testing

| Target | Value |
|---|---|
| Capacity per server | 60 lab PCs, 5 live rooms, 2,000 students, 500 GB content |
| 40 students join a lesson | < 60 s total |
| Content < 100 MB opens on a lab PC | < 3 s when cached |
| Student app idle memory | < 300 MB on a 4 GB PC |
| Recovery after power loss | < 2 min to serving, no data loss for acked writes |
| Uptime in school hours | 99.5% |

| Test | What it proves |
|---|---|
| Contract tests | UI and server agree on every API and relay message |
| Load test | Simulated 60 PCs in a lesson meet latency targets |
| Offline / chaos | Network pulled mid-lesson, server killed, power cut: outbox and reconnect recover with no lost answers |
| Windows matrix | Windows 10 22H2 and 11 on 4 GB and 8 GB PCs; one real ICT lab rig in the office |
| Privacy | Every analytics event passes the allow-list and holds no identifiers |
| AI | Fixed prompts per feature return valid structured output within time on reference hardware |
