import { randomUUID } from 'node:crypto';
import {
  INK_POINTS_MAX, INK_SHOW_STROKES_MAX, INK_STROKES_MAX, SCREEN_REPORTS_MAX, SHOW_STALE_MS, WHITEBOARD_PAGES_MAX, showRoom,
  type ContentItem, type Ink, type InkAdd, type InkEvent, type InkStroke, type Principal, type ScreenReport, type Show, type ShowKind, type ShowPage, type ShowStart,
  type ShowUpdate, type StaffPrincipal, type StudentPrincipal,
} from '@ict/contracts';
import type { AuditLog } from '../../core/audit.js';
import type { Clock } from '../../core/clock.js';
import { AppError, notFound } from '../../core/errors.js';
import { noEventLog, type EventLog } from '../../core/event-log.js';
import { scopeOf, seesClass, seesQuiz } from '../../core/scope.js';
import type { Relay } from '../../relay/relay.js';
import type { ContentRepository } from '../content/content.repository.js';

interface Live {
  id: string;
  kind: ShowKind;
  // The library item being shown; null for a whiteboard. The class is kept on its own, since a
  // whiteboard has no item to take it from.
  item: ContentItem | null;
  classId: string;
  className: string;
  // The page every screen is on, and how many pages there are once known (see `Show`).
  page: number;
  pages: number | null;
  by: string;
  byName: string;
  playing: boolean;
  position: number;
  rate: number;
  at: number;
  // When the teacher's app last spoke. A show that has gone quiet is over.
  heardAt: number;
  // How many reports each student's screen has made, so one broken PC cannot flood the diary.
  reports: Map<string, number>;
  // The students whose screens have the video open, by id.
  watching: Map<string, string>;
  // The writing on the video, oldest line first, and the student who holds the pen, if any.
  strokes: Map<string, InkStroke>;
  inkRev: number;
  pen: { studentId: string; name: string } | null;
  // The students asking for the pen, by id, in the order they asked; and those the teacher said
  // "not now" to, until they ask again.
  asks: Map<string, string>;
  refused: Set<string>;
}

// "Show to class". One show per class at a time, kept in memory: it is about the lesson going on now,
// and a server restart ends it. Writes come over REST; the relay pushes the new state to the class's
// screens (room "show:<classId>") the moment it changes.
export class ShowService {
  private readonly byClass = new Map<string, Live>();
  // Shows that were ended on purpose (stopped, or another show took the class). The teacher's app is
  // told "that show is over" for these. A show the server simply no longer knows (it went quiet for
  // too long, or the server restarted) gets "not found" instead, and her app starts it again by itself.
  private readonly over = new Set<string>();

  constructor(
    private readonly now: Clock,
    private readonly content: ContentRepository,
    private readonly relay: Relay,
    private readonly audit: AuditLog,
    // The server's diary (events.log), and the name of a lab PC for it.
    private readonly log: EventLog = noEventLog,
    private readonly pcName: (deviceId: string) => string | undefined = () => undefined,
    // Is this student signed in on a lab PC right now? A student who has left cannot hold the pen.
    private readonly signedIn: (studentId: string) => boolean = () => true,
    // A class's name, or undefined when there is no such class. A whiteboard is shown to a class
    // the teacher picks, not taken from a library item, so its name is looked up here.
    private readonly className: (classId: string) => string | undefined = () => undefined,
  ) {
    relay.register({
      prefix: 'show',
      // A student listens to their own class only; a teacher to the classes she teaches.
      canJoin: (p, classId) => (p.kind === 'student' ? p.classId === classId : p.kind === 'staff' && seesClass(scopeOf(p), classId)),
      snapshot: (p, classId) => this.forClass(classId, p.kind === 'staff', p.kind === 'student' ? p.studentId : undefined),
    });
  }

  // Showing something new to the same class replaces what was shown before.
  start(actor: StaffPrincipal, input: ShowStart): Show {
    const what = 'whiteboard' in input ? this.whiteboard(actor, input.classId) : this.libraryItem(actor, input.contentId);
    const now = this.now();
    const before = this.byClass.get(what.classId);
    if (before) {
      this.markOver(before.id);
      this.log('show.replaced', this.words(before));
    }
    const live: Live = {
      id: randomUUID(), ...what, page: 1, by: actor.userId, byName: actor.displayName, playing: false, position: 0, rate: 1, at: now, heardAt: now,
      reports: new Map(), watching: new Map(), strokes: new Map(), inkRev: 0, pen: null, asks: new Map(), refused: new Set(),
    };
    this.byClass.set(live.classId, live);
    this.audit.record({ kind: 'staff', id: actor.userId }, 'show.start', live.item?.id ?? live.classId, { title: this.title(live), kind: live.kind, classId: live.classId });
    this.log('show.started', this.words(live));
    this.relay.notify(showRoom(live.classId));
    return this.view(live, true);
  }

  // Move every screen to another page. Only the teacher who is showing; it also counts as "still here".
  page(actor: StaffPrincipal, id: string, input: ShowPage): Show {
    const live = this.mine(actor, id);
    const bad = (message: string) => new AppError(400, 'BAD_REQUEST', message);
    if (live.kind === 'video') throw bad('A video has no pages.');
    let pages = live.pages;
    if (input.pages !== undefined && input.pages !== live.pages) {
      // A PDF: the teacher's app counted the pages of the file. A whiteboard: "Add page", one at a time.
      if (live.kind === 'image') throw bad('A picture is one page.');
      if (live.kind === 'whiteboard' && (input.pages !== (live.pages ?? 0) + 1 || input.pages > WHITEBOARD_PAGES_MAX)) {
        throw bad(`A whiteboard gains one page at a time, up to ${WHITEBOARD_PAGES_MAX}.`);
      }
      pages = input.pages;
    }
    if (pages !== null && input.page > pages) throw bad('There is no such page.');
    const changed = live.page !== input.page || live.pages !== pages;
    Object.assign(live, { page: input.page, pages, heardAt: this.now() });
    if (changed) {
      this.log('show.page', { show: short(live.id), page: live.page, pages: live.pages ?? undefined });
      this.relay.notify(showRoom(live.classId));
    }
    return this.view(live, true);
  }

  // Only the teacher who is showing can move it. Every call also counts as "still here".
  update(actor: StaffPrincipal, id: string, input: ShowUpdate): Show {
    const live = this.mine(actor, id);
    if (live.kind !== 'video') throw new AppError(400, 'BAD_REQUEST', 'Only a video plays.');
    const now = this.now();
    const jumped = Math.abs(expected(live, now) - input.position) > 0.5;
    const changed = live.playing !== input.playing || live.rate !== input.rate || jumped;
    Object.assign(live, { playing: input.playing, position: input.position, rate: input.rate, at: now, heardAt: now });
    // A plain "still here" with nothing new is not sent on to 40 screens.
    if (changed) {
      this.log(input.playing ? 'show.playing' : 'show.paused', { show: short(live.id), at: seconds(input.position), speed: input.rate });
      // The writing was about the moment the video stood at. Once it plays or jumps, it goes.
      if (input.playing || jumped) this.wipe(live);
      this.relay.notify(showRoom(live.classId));
    }
    return this.view(live, true);
  }

  // "Still here", and nothing more. Where the video is does not change.
  beat(actor: StaffPrincipal, id: string) {
    this.mine(actor, id).heardAt = this.now();
  }

  stop(actor: StaffPrincipal, id: string) {
    const live = this.mine(actor, id);
    this.markOver(live.id);
    this.end(live);
    this.audit.record({ kind: 'staff', id: actor.userId }, 'show.stop', live.item?.id ?? live.classId, { title: this.title(live) });
    this.log('show.stopped', this.words(live));
  }

  // A student's screen says how the video is going there. Only written down: it changes nothing.
  // A report about a show that is already over is dropped without fuss.
  screen(me: StudentPrincipal, id: string, input: ScreenReport) {
    const live = this.byClass.get(me.classId);
    if (!live || live.id !== id) return;
    const said = live.reports.get(me.studentId) ?? 0;
    if (said >= SCREEN_REPORTS_MAX) return;
    live.reports.set(me.studentId, said + 1);
    live.watching.set(me.studentId, me.name);
    this.log(`show.screen.${input.event}`, { show: short(live.id), student: me.name, pc: this.pcName(me.deviceId), at: seconds(input.position), behind: seconds(input.behind) });
  }

  // --- Writing on the video ---

  ink(p: Principal, id: string): Ink {
    const live = this.seen(p, id);
    return { rev: live.inkRev, strokes: [...live.strokes.values()] };
  }

  // More of one pen line. The teacher may write at any time. The student with the pen may write
  // while the video is paused; on a playing video the line would be about a moment already gone.
  write(p: Principal, id: string, input: InkAdd) {
    const live = this.seen(p, id);
    const who = this.writer(p, live);
    if (p.kind === 'student' && live.playing) throw new AppError(409, 'SHOW_PLAYING', 'You can write when your teacher pauses the video.');
    if (p.kind === 'staff') {
      // The teacher writes on the page in front of her, which may be a step ahead of the server's
      // when her page turn is still on its way. Any page the show has will do.
      const last = live.kind === 'video' ? 1 : live.pages;
      if (last !== null && input.page > last) throw new AppError(400, 'BAD_REQUEST', 'There is no such page.');
    } else if (input.page !== live.page) {
      // A student's screen follows the teacher's; a line for any other page is about something no longer on show.
      throw new AppError(409, 'WRONG_PAGE', 'Your teacher has moved to another page.');
    }
    let stroke = live.strokes.get(input.strokeId);
    if (stroke && stroke.by !== who.by) throw new AppError(403, 'FORBIDDEN', 'That line is not yours.');
    if (!stroke) {
      const onPage = [...live.strokes.values()].filter((x) => x.page === input.page).length;
      if (onPage >= INK_STROKES_MAX || live.strokes.size >= INK_SHOW_STROKES_MAX) throw new AppError(409, 'INK_FULL', 'There is no room left to write. Wipe the writing first.');
      if (!live.strokes.size) this.log('show.ink.started', { show: short(live.id), by: who.byName });
      stroke = { id: input.strokeId, ...who, page: input.page, colour: input.colour, width: input.width, points: [] };
      live.strokes.set(stroke.id, stroke);
    }
    // A line that is already as long as it may be simply stops growing.
    const more = input.points.slice(0, Math.max(0, INK_POINTS_MAX * 3 - stroke.points.length));
    stroke.points.push(...more);
    live.inkRev += 1;
    this.say(live, { kind: 'add', show: live.id, rev: live.inkRev, stroke: { ...stroke, points: more } });
  }

  // The teacher may rub out any line; a student only a line of their own, and only with the pen.
  erase(p: Principal, id: string, strokeId: string) {
    const live = this.seen(p, id);
    const who = this.writer(p, live);
    const stroke = live.strokes.get(strokeId);
    if (!stroke) return;
    if (p.kind !== 'staff' && stroke.by !== who.by) throw new AppError(403, 'FORBIDDEN', 'That line is not yours.');
    live.strokes.delete(strokeId);
    live.inkRev += 1;
    this.say(live, { kind: 'erase', show: live.id, rev: live.inkRev, strokeId });
  }

  // Wipes `page`: the page on the teacher's screen. An older teacher's app says none; then the page the show is on.
  clear(actor: StaffPrincipal, id: string, page?: number) {
    const live = this.mine(actor, id);
    const on = page ?? live.page;
    if ([...live.strokes.values()].some((x) => x.page === on)) this.log('show.ink.cleared', { show: short(live.id), by: actor.displayName });
    this.wipe(live, on);
  }

  // One student at a time holds the pen. Giving it to another takes it from the first.
  givePen(actor: StaffPrincipal, id: string, studentId: string | null): Show {
    const live = this.mine(actor, id);
    if (live.pen) this.log('show.pen.taken', { show: short(live.id), student: live.pen.name });
    live.pen = null;
    if (studentId) {
      const name = live.watching.get(studentId);
      if (!name || !this.signedIn(studentId)) throw new AppError(409, 'NOT_WATCHING', "That student's screen does not have the video open.");
      live.pen = { studentId, name };
      live.asks.delete(studentId);
      live.refused.delete(studentId);
      this.log('show.pen.given', { show: short(live.id), student: name });
    }
    this.relay.notify(showRoom(live.classId));
    return this.view(live, true);
  }

  // --- Asking for the pen ---

  // A student asks the teacher for the pen. Asking again while waiting, or while holding the pen,
  // changes nothing and tells nobody.
  ask(me: StudentPrincipal, id: string) {
    const live = this.seen(me, id);
    if (live.pen?.studentId === me.studentId || live.asks.has(me.studentId)) return;
    // Her screen clearly has the show open, so she can be given the pen.
    live.watching.set(me.studentId, me.name);
    live.asks.set(me.studentId, me.name);
    live.refused.delete(me.studentId);
    this.log('show.pen.asked', { show: short(live.id), student: me.name });
    this.relay.notify(showRoom(live.classId));
  }

  // A student takes back her ask (or clears a "not now").
  unask(me: StudentPrincipal, id: string) {
    const live = this.seen(me, id);
    const asked = live.asks.delete(me.studentId);
    const refused = live.refused.delete(me.studentId);
    if (!asked && !refused) return;
    this.relay.notify(showRoom(live.classId));
  }

  // The teacher says "not now" to one asker. Her screen says so until she asks again.
  refuse(actor: StaffPrincipal, id: string, studentId: string) {
    const live = this.mine(actor, id);
    const name = live.asks.get(studentId);
    if (name === undefined) return;
    live.asks.delete(studentId);
    live.refused.add(studentId);
    this.log('show.pen.refused', { show: short(live.id), student: name });
    this.relay.notify(showRoom(live.classId));
  }

  forStudent(me: StudentPrincipal): Show | null {
    return this.forClass(me.classId, false, me.studentId);
  }

  // `studentId` is the student the state is for, who is told where her own ask stands.
  forClass(classId: string, forTeacher = false, studentId?: string): Show | null {
    const live = this.byClass.get(classId);
    if (!live) return null;
    // Gone quiet (the teacher's app closed or lost the network), or its item left the library: over.
    // A whiteboard has no item, so only silence ends it.
    if (this.now() - live.heardAt > SHOW_STALE_MS || (live.item && !this.content.get(live.item.id))) {
      this.byClass.delete(classId);
      this.log('show.gone_quiet', this.words(live));
      return null;
    }
    // A student who has signed out no longer holds the pen.
    if (live.pen && !this.signedIn(live.pen.studentId)) {
      this.log('show.pen.taken', { show: short(live.id), student: live.pen.name });
      live.pen = null;
    }
    // Nor is one asking for it.
    for (const asker of live.asks.keys()) if (!this.signedIn(asker)) live.asks.delete(asker);
    return this.view(live, forTeacher, studentId);
  }

  // Ends shows that have gone quiet and tells their classes. Called on a timer by the server.
  sweep() {
    for (const [classId, live] of this.byClass) {
      if (this.now() - live.heardAt > SHOW_STALE_MS) {
        this.byClass.delete(classId);
        this.log('show.gone_quiet', this.words(live));
        this.relay.notify(showRoom(classId));
      }
    }
  }

  // A library item this teacher may show: a video, a PDF or a picture. A PDF's page count is not
  // known until the teacher's app opens the file; a picture is one page; a video has none.
  private libraryItem(actor: StaffPrincipal, contentId: string) {
    const item = this.content.get(contentId);
    // A library item for a class or subject this teacher does not teach looks the same as none.
    if (!item || !seesQuiz(scopeOf(actor), item)) throw notFound('Library item');
    if (item.kind !== 'video' && item.kind !== 'pdf' && item.kind !== 'image') throw new AppError(400, 'BAD_REQUEST', 'Only a video, PDF or picture can be shown to the class.');
    return { kind: item.kind, item, classId: item.classId, className: item.className, pages: item.kind === 'image' ? 1 : null };
  }

  // A blank whiteboard with one page, for a class this teacher teaches. Any other class looks the same as none.
  private whiteboard(actor: StaffPrincipal, classId: string) {
    const className = this.className(classId);
    if (className === undefined || !seesClass(scopeOf(actor), classId)) throw notFound('Class');
    return { kind: 'whiteboard' as const, item: null, classId, className, pages: 1 };
  }

  private mine(actor: StaffPrincipal, id: string): Live {
    if (this.over.has(id)) throw new AppError(410, 'SHOW_OVER', 'This show has ended.');
    const live = [...this.byClass.values()].find((l) => l.id === id);
    if (!live || live.by !== actor.userId || !this.forClass(live.classId)) throw notFound('Show');
    return live;
  }

  // The show `id`, for someone who may see it: the teacher showing it, or a student of its class.
  private seen(p: Principal, id: string): Live {
    if (p.kind === 'staff') return this.mine(p, id);
    const live = p.kind === 'student' ? this.byClass.get(p.classId) : undefined;
    if (!live || live.id !== id || !this.forClass(live.classId)) throw notFound('Show');
    return live;
  }

  // Who is writing, if they may: the teacher, or the student who holds the pen.
  private writer(p: Principal, live: Live): { by: string; byName: string } {
    if (p.kind === 'staff') return { by: 'teacher', byName: p.displayName };
    if (p.kind !== 'student' || live.pen?.studentId !== p.studentId) throw new AppError(403, 'NO_PEN', 'Your teacher has not given you the pen.');
    return { by: p.studentId, byName: p.name };
  }

  // Wipes the writing on one page (the page the show is on, unless told); other pages keep theirs.
  private wipe(live: Live, page = live.page) {
    const here = [...live.strokes].filter(([, x]) => x.page === page);
    if (!here.length) return;
    for (const [id] of here) live.strokes.delete(id);
    live.inkRev += 1;
    this.say(live, { kind: 'clear', show: live.id, rev: live.inkRev, page });
  }

  private say(live: Live, event: InkEvent) {
    this.relay.emit(showRoom(live.classId), event);
  }

  private markOver(id: string) {
    this.over.add(id);
    // Only the latest few matter; an old id is never asked about again.
    if (this.over.size > 200) this.over.delete(this.over.values().next().value!);
  }

  private end(live: Live) {
    if (this.byClass.get(live.classId) === live) this.byClass.delete(live.classId);
    this.relay.notify(showRoom(live.classId));
  }

  // What a diary line says about a show.
  private words(live: Live) {
    return { show: short(live.id), video: this.title(live), class: live.className, by: live.byName, screens: live.reports.size || undefined };
  }

  private title(live: Live) {
    return live.item?.title ?? 'Whiteboard';
  }

  private view(live: Live, forTeacher = false, studentId?: string): Show {
    return {
      id: live.id, classId: live.classId, className: live.className, kind: live.kind, item: live.item, byName: live.byName,
      page: live.page, pages: live.pages, playing: live.playing, position: live.position, rate: live.rate, at: live.at, now: this.now(), inkRev: live.inkRev, pen: live.pen,
      myAsk: studentId === undefined ? 'none' : live.asks.has(studentId) ? 'waiting' : live.refused.has(studentId) ? 'refused' : 'none',
      ...(forTeacher ? {
        watching: [...live.watching].map(([studentId, name]) => ({ studentId, name })),
        asks: [...live.asks].map(([studentId, name]) => ({ studentId, name })),
      } : {}),
    };
  }
}

// Where the video is by now, going by what the teacher last said.
const expected = (l: Live, now: number) => (l.playing ? l.position + ((now - l.at) / 1000) * l.rate : l.position);

// A show's id is long; its first part is enough to tell the lines of one show from another's.
const short = (id: string) => id.slice(0, 8);
const seconds = (n: number) => Math.round(n * 10) / 10;
