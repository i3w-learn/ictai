import { randomUUID } from 'node:crypto';
import {
  SCREEN_REPORTS_MAX, SHOW_KINDS, WHITEBOARD_PAGES_MAX, canShow, showRoom, startingPages,
  type ScreenReport, type Show, type ShowPage, type ShowStart, type ShowUpdate, type StaffPrincipal, type StudentPrincipal,
} from '@ict/contracts';
import type { AuditLog } from '../../core/audit.js';
import type { Clock } from '../../core/clock.js';
import { AppError, notFound } from '../../core/errors.js';
import { noEventLog, type EventLog } from '../../core/event-log.js';
import { scopeOf, seesClass, seesQuiz } from '../../core/scope.js';
import type { Relay } from '../../relay/relay.js';
import type { ContentRepository } from '../content/content.repository.js';
import type { DeviceRepository } from '../devices/device.repository.js';
import type { ClassRepository } from '../students/class.repository.js';
import type { ShowPenService } from './show-pen.service.js';
import { short, type Live, type ShowStore } from './show.store.js';

// "Show to class": starting and stopping a show, and where it is (the page, or the video's place).
// One show per class at a time (see ShowStore). Writes come over REST; the relay pushes the new state
// to the class's screens (room "show:<classId>") the moment it changes.
export class ShowService {
  constructor(
    private readonly now: Clock,
    private readonly store: ShowStore,
    // A video's writing is wiped when it plays or jumps.
    private readonly pens: ShowPenService,
    private readonly content: ContentRepository,
    // A whiteboard is shown to a class the teacher picks, not taken from a library item, so its
    // class name is looked up here.
    private readonly classes: ClassRepository,
    // The name of a lab PC, for the diary.
    private readonly devices: DeviceRepository,
    private readonly relay: Relay,
    private readonly audit: AuditLog,
    // The server's diary (events.log).
    private readonly log: EventLog = noEventLog,
  ) {
    relay.register({
      prefix: 'show',
      // A student listens to their own class only; a teacher to the classes she teaches.
      canJoin: (p, classId) => (p.kind === 'student' ? p.classId === classId : p.kind === 'staff' && seesClass(scopeOf(p), classId)),
      snapshot: (p, classId) => this.store.forClass(classId, p.kind === 'staff', p.kind === 'student' ? p.studentId : undefined),
    });
  }

  // Showing something new to the same class replaces what was shown before.
  start(actor: StaffPrincipal, input: ShowStart): Show {
    const what = 'whiteboard' in input ? this.whiteboard(actor, input.classId) : this.libraryItem(actor, input.contentId);
    const now = this.now();
    const before = this.store.get(what.classId);
    if (before) {
      this.store.markOver(before.id);
      this.log('show.replaced', this.store.words(before));
    }
    const live: Live = {
      id: randomUUID(), ...what, page: 1, by: actor.userId, byName: actor.displayName, playing: false, position: 0, rate: 1, at: now, heardAt: now,
      reports: new Map(), watching: new Map(), strokes: new Map(), inkRev: 0, pen: null, asks: new Map(), refused: new Set(),
    };
    this.store.set(live);
    this.audit.record({ kind: 'staff', id: actor.userId }, 'show.start', live.item?.id ?? live.classId, { title: this.store.title(live), kind: live.kind, classId: live.classId });
    this.log('show.started', this.store.words(live));
    this.relay.notify(showRoom(live.classId));
    return this.store.view(live, true);
  }

  // Move every screen to another page. Only the teacher who is showing; it also counts as "still here".
  page(actor: StaffPrincipal, id: string, input: ShowPage): Show {
    const live = this.store.mine(actor, id);
    const bad = (message: string) => new AppError(400, 'BAD_REQUEST', message);
    const rule = SHOW_KINDS[live.kind].pages;
    if (rule === 'none') throw bad('A video has no pages.');
    let pages = live.pages;
    if (input.pages !== undefined && input.pages !== live.pages) {
      // A PDF: the teacher's app counted the pages of the file. A whiteboard: "Add page", one at a time.
      if (rule === 'one') throw bad('A picture is one page.');
      if (rule === 'grows' && (input.pages !== (live.pages ?? 0) + 1 || input.pages > WHITEBOARD_PAGES_MAX)) {
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
    return this.store.view(live, true);
  }

  // Only the teacher who is showing can move it. Every call also counts as "still here".
  update(actor: StaffPrincipal, id: string, input: ShowUpdate): Show {
    const live = this.store.mine(actor, id);
    if (live.kind !== 'video') throw new AppError(400, 'BAD_REQUEST', 'Only a video plays.');
    const now = this.now();
    const jumped = Math.abs(expected(live, now) - input.position) > 0.5;
    const changed = live.playing !== input.playing || live.rate !== input.rate || jumped;
    Object.assign(live, { playing: input.playing, position: input.position, rate: input.rate, at: now, heardAt: now });
    // A plain "still here" with nothing new is not sent on to 40 screens.
    if (changed) {
      this.log(input.playing ? 'show.playing' : 'show.paused', { show: short(live.id), at: seconds(input.position), speed: input.rate });
      // The writing was about the moment the video stood at. Once it plays or jumps, it goes.
      if (input.playing || jumped) this.pens.wipe(live);
      this.relay.notify(showRoom(live.classId));
    }
    return this.store.view(live, true);
  }

  // "Still here", and nothing more. Where the video is does not change.
  beat(actor: StaffPrincipal, id: string) {
    this.store.mine(actor, id).heardAt = this.now();
  }

  stop(actor: StaffPrincipal, id: string) {
    const live = this.store.mine(actor, id);
    this.store.markOver(live.id);
    if (this.store.get(live.classId) === live) this.store.drop(live.classId);
    this.relay.notify(showRoom(live.classId));
    this.audit.record({ kind: 'staff', id: actor.userId }, 'show.stop', live.item?.id ?? live.classId, { title: this.store.title(live) });
    this.log('show.stopped', this.store.words(live));
  }

  // A student's screen says how the video is going there. Only written down: it changes nothing.
  // A report about a show that is already over is dropped without fuss.
  screen(me: StudentPrincipal, id: string, input: ScreenReport) {
    const live = this.store.get(me.classId);
    if (!live || live.id !== id) return;
    const said = live.reports.get(me.studentId) ?? 0;
    if (said >= SCREEN_REPORTS_MAX) return;
    live.reports.set(me.studentId, said + 1);
    live.watching.set(me.studentId, me.name);
    this.log(`show.screen.${input.event}`, { show: short(live.id), student: me.name, pc: this.devices.name(me.deviceId), at: seconds(input.position), behind: seconds(input.behind) });
  }

  forStudent(me: StudentPrincipal): Show | null {
    return this.store.forClass(me.classId, false, me.studentId);
  }

  // Ends shows that have gone quiet and tells their classes. Called on a timer by the server.
  sweep() {
    for (const [classId, live] of this.store.all()) {
      if (this.store.stale(live)) {
        this.store.drop(classId);
        this.log('show.gone_quiet', this.store.words(live));
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
    if (!canShow(item.kind)) throw new AppError(400, 'BAD_REQUEST', 'Only a video, PDF or picture can be shown to the class.');
    return { kind: item.kind, item, classId: item.classId, className: item.className, pages: startingPages(item.kind) };
  }

  // A blank whiteboard with one page, for a class this teacher teaches. Any other class looks the same as none.
  private whiteboard(actor: StaffPrincipal, classId: string) {
    const className = this.classes.name(classId);
    if (className === undefined || !seesClass(scopeOf(actor), classId)) throw notFound('Class');
    return { kind: 'whiteboard' as const, item: null, classId, className, pages: startingPages('whiteboard') };
  }
}

// Where the video is by now, going by what the teacher last said.
const expected = (l: Live, now: number) => (l.playing ? l.position + ((now - l.at) / 1000) * l.rate : l.position);

const seconds = (n: number) => Math.round(n * 10) / 10;
