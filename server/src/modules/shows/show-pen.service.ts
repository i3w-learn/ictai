import {
  INK_POINTS_MAX, INK_SHOW_STROKES_MAX, INK_STROKES_MAX, SHOW_KINDS, showRoom,
  type Ink, type InkAdd, type InkEvent, type Principal, type Show, type StaffPrincipal, type StudentPrincipal,
} from '@ict/contracts';
import { AppError } from '../../core/errors.js';
import { noEventLog, type EventLog } from '../../core/event-log.js';
import type { Relay } from '../../relay/relay.js';
import { short, type Live, type ShowStore } from './show.store.js';

// Writing on a show, and the pen. The teacher writes on what she is showing and the whole class
// sees it; she may hand the pen to one student at a time, and students may ask her for it. Each
// change to the writing goes to the class's screens as one small event (room "show:<classId>").
export class ShowPenService {
  constructor(
    private readonly store: ShowStore,
    private readonly relay: Relay,
    // Is this student signed in on a lab PC right now? A student who has left cannot hold the pen.
    private readonly signedIn: (studentId: string) => boolean,
    // The server's diary (events.log).
    private readonly log: EventLog = noEventLog,
  ) {}

  ink(p: Principal, id: string): Ink {
    const live = this.store.seen(p, id);
    return { rev: live.inkRev, strokes: [...live.strokes.values()] };
  }

  // More of one pen line. The teacher may write at any time. The student with the pen may write
  // while the video is paused; on a playing video the line would be about a moment already gone.
  write(p: Principal, id: string, input: InkAdd) {
    const live = this.store.seen(p, id);
    const who = this.writer(p, live);
    if (p.kind === 'student' && live.playing) throw new AppError(409, 'SHOW_PLAYING', 'You can write when your teacher pauses the video.');
    if (p.kind === 'staff') {
      // The teacher writes on the page in front of her, which may be a step ahead of the server's
      // when her page turn is still on its way. Any page the show has will do.
      const last = SHOW_KINDS[live.kind].pages === 'none' ? 1 : live.pages;
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
    const live = this.store.seen(p, id);
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
    const live = this.store.mine(actor, id);
    const on = page ?? live.page;
    if ([...live.strokes.values()].some((x) => x.page === on)) this.log('show.ink.cleared', { show: short(live.id), by: actor.displayName });
    this.wipe(live, on);
  }

  // Wipes the writing on one page (the page the show is on, unless told); other pages keep theirs.
  wipe(live: Live, page = live.page) {
    const here = [...live.strokes].filter(([, x]) => x.page === page);
    if (!here.length) return;
    for (const [id] of here) live.strokes.delete(id);
    live.inkRev += 1;
    this.say(live, { kind: 'clear', show: live.id, rev: live.inkRev, page });
  }

  // One student at a time holds the pen. Giving it to another takes it from the first. The new
  // student is checked first, so a refused give leaves the pen where it was.
  givePen(actor: StaffPrincipal, id: string, studentId: string | null): Show {
    const live = this.store.mine(actor, id);
    const name = studentId ? live.watching.get(studentId) : undefined;
    if (studentId && (!name || !this.signedIn(studentId))) throw new AppError(409, 'NOT_WATCHING', "That student's screen does not have the show open.");
    if (live.pen) this.log('show.pen.taken', { show: short(live.id), student: live.pen.name });
    live.pen = null;
    if (studentId && name) {
      live.pen = { studentId, name };
      live.asks.delete(studentId);
      live.refused.delete(studentId);
      this.log('show.pen.given', { show: short(live.id), student: name });
    }
    this.relay.notify(showRoom(live.classId));
    return this.store.view(live, true);
  }

  // --- Asking for the pen ---

  // A student asks the teacher for the pen. Asking again while waiting, or while holding the pen,
  // changes nothing and tells nobody.
  ask(me: StudentPrincipal, id: string) {
    const live = this.store.seen(me, id);
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
    const live = this.store.seen(me, id);
    const asked = live.asks.delete(me.studentId);
    const refused = live.refused.delete(me.studentId);
    if (!asked && !refused) return;
    this.relay.notify(showRoom(live.classId));
  }

  // The teacher says "not now" to one asker. Her screen says so until she asks again.
  refuse(actor: StaffPrincipal, id: string, studentId: string) {
    const live = this.store.mine(actor, id);
    const name = live.asks.get(studentId);
    if (name === undefined) return;
    live.asks.delete(studentId);
    live.refused.add(studentId);
    this.log('show.pen.refused', { show: short(live.id), student: name });
    this.relay.notify(showRoom(live.classId));
  }

  // Who is writing, if they may: the teacher, or the student who holds the pen.
  private writer(p: Principal, live: Live): { by: string; byName: string } {
    if (p.kind === 'staff') return { by: 'teacher', byName: p.displayName };
    if (p.kind !== 'student' || live.pen?.studentId !== p.studentId) throw new AppError(403, 'NO_PEN', 'Your teacher has not given you the pen.');
    return { by: p.studentId, byName: p.name };
  }

  private say(live: Live, event: InkEvent) {
    this.relay.emit(showRoom(live.classId), event);
  }
}
