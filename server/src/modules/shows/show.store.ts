import { SHOW_STALE_MS, type ContentItem, type InkStroke, type Principal, type Show, type ShowKind, type StaffPrincipal } from '@ict/contracts';
import type { Clock } from '../../core/clock.js';
import { AppError, notFound } from '../../core/errors.js';
import { noEventLog, type EventLog } from '../../core/event-log.js';
import type { ContentRepository } from '../content/content.repository.js';

export interface Live {
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

// The shows going on now, one per class, kept in memory: a show is about the lesson going on now,
// and a server restart ends it. This keeps them, finds them for whoever may see them, and drops the
// ones that are over. What may be done with a show is up to the services that use it.
export class ShowStore {
  private readonly byClass = new Map<string, Live>();
  // Shows that were ended on purpose (stopped, or another show took the class). The teacher's app is
  // told "that show is over" for these. A show the server simply no longer knows (it went quiet for
  // too long, or the server restarted) gets "not found" instead, and her app starts it again by itself.
  private readonly over = new Set<string>();

  constructor(
    private readonly now: Clock,
    private readonly content: ContentRepository,
    // Is this student signed in on a lab PC right now? A student who has left cannot hold the pen.
    private readonly signedIn: (studentId: string) => boolean,
    // The server's diary (events.log).
    private readonly log: EventLog = noEventLog,
  ) {}

  // The show on a class right now, as it is, whether or not it has gone quiet.
  get(classId: string): Live | undefined {
    return this.byClass.get(classId);
  }

  set(live: Live) {
    this.byClass.set(live.classId, live);
  }

  // Every class's show, for the sweep. It may drop shows as it goes.
  all(): [string, Live][] {
    return [...this.byClass];
  }

  drop(classId: string) {
    this.byClass.delete(classId);
  }

  // The teacher's app has gone quiet for too long.
  stale(live: Live) {
    return this.now() - live.heardAt > SHOW_STALE_MS;
  }

  // `studentId` is the student the state is for, who is told where her own ask stands.
  forClass(classId: string, forTeacher = false, studentId?: string): Show | null {
    const live = this.byClass.get(classId);
    if (!live) return null;
    // Gone quiet (the teacher's app closed or lost the network), or its item left the library: over.
    // A whiteboard has no item, so only silence ends it.
    if (this.stale(live) || (live.item && !this.content.get(live.item.id))) {
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

  // The show `id`, for the teacher who is showing it.
  mine(actor: StaffPrincipal, id: string): Live {
    if (this.over.has(id)) throw new AppError(410, 'SHOW_OVER', 'This show has ended.');
    const live = [...this.byClass.values()].find((l) => l.id === id);
    if (!live || live.by !== actor.userId || !this.forClass(live.classId)) throw notFound('Show');
    return live;
  }

  // The show `id`, for someone who may see it: the teacher showing it, or a student of its class.
  seen(p: Principal, id: string): Live {
    if (p.kind === 'staff') return this.mine(p, id);
    const live = p.kind === 'student' ? this.byClass.get(p.classId) : undefined;
    if (!live || live.id !== id || !this.forClass(live.classId)) throw notFound('Show');
    return live;
  }

  markOver(id: string) {
    this.over.add(id);
    // Only the latest few matter; an old id is never asked about again.
    if (this.over.size > 200) this.over.delete(this.over.values().next().value!);
  }

  // What a diary line says about a show.
  words(live: Live) {
    return { show: short(live.id), video: this.title(live), class: live.className, by: live.byName, screens: live.reports.size || undefined };
  }

  title(live: Live) {
    return live.item?.title ?? 'Whiteboard';
  }

  view(live: Live, forTeacher = false, studentId?: string): Show {
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

// A show's id is long; its first part is enough to tell the lines of one show from another's.
export const short = (id: string) => id.slice(0, 8);
