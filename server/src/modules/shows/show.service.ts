import { randomUUID } from 'node:crypto';
import { SHOW_STALE_MS, showRoom, type ContentItem, type Show, type ShowUpdate, type StaffPrincipal, type StudentPrincipal } from '@ict/contracts';
import type { AuditLog } from '../../core/audit.js';
import type { Clock } from '../../core/clock.js';
import { AppError, notFound } from '../../core/errors.js';
import { scopeOf, seesClass, seesQuiz } from '../../core/scope.js';
import type { Relay } from '../../relay/relay.js';
import type { ContentRepository } from '../content/content.repository.js';

interface Live {
  id: string;
  item: ContentItem;
  by: string;
  byName: string;
  playing: boolean;
  position: number;
  rate: number;
  at: number;
  // When the teacher's app last spoke. A show that has gone quiet is over.
  heardAt: number;
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
  ) {
    relay.register({
      prefix: 'show',
      // A student listens to their own class only; a teacher to the classes she teaches.
      canJoin: (p, classId) => (p.kind === 'student' ? p.classId === classId : p.kind === 'staff' && seesClass(scopeOf(p), classId)),
      snapshot: (_p, classId) => this.forClass(classId),
    });
  }

  // Showing a second video to the same class replaces the first.
  start(actor: StaffPrincipal, contentId: string): Show {
    const item = this.content.get(contentId);
    // A library item for a class or subject this teacher does not teach looks the same as none.
    if (!item || !seesQuiz(scopeOf(actor), item)) throw notFound('Library item');
    if (item.kind !== 'video') throw new AppError(400, 'BAD_REQUEST', 'Only a video can be shown to the class.');
    const now = this.now();
    const before = this.byClass.get(item.classId);
    if (before) this.markOver(before.id);
    const live: Live = { id: randomUUID(), item, by: actor.userId, byName: actor.displayName, playing: false, position: 0, rate: 1, at: now, heardAt: now };
    this.byClass.set(item.classId, live);
    this.audit.record({ kind: 'staff', id: actor.userId }, 'show.start', item.id, { title: item.title, classId: item.classId });
    this.relay.notify(showRoom(item.classId));
    return this.view(live);
  }

  // Only the teacher who is showing can move it. Every call also counts as "still here".
  update(actor: StaffPrincipal, id: string, input: ShowUpdate): Show {
    const live = this.mine(actor, id);
    const now = this.now();
    const changed = live.playing !== input.playing || live.rate !== input.rate || Math.abs(expected(live, now) - input.position) > 0.5;
    Object.assign(live, { playing: input.playing, position: input.position, rate: input.rate, at: now, heardAt: now });
    // A plain "still here" with nothing new is not sent on to 40 screens.
    if (changed) this.relay.notify(showRoom(live.item.classId));
    return this.view(live);
  }

  stop(actor: StaffPrincipal, id: string) {
    const live = this.mine(actor, id);
    this.markOver(live.id);
    this.end(live);
    this.audit.record({ kind: 'staff', id: actor.userId }, 'show.stop', live.item.id, { title: live.item.title });
  }

  forStudent(me: StudentPrincipal): Show | null {
    return this.forClass(me.classId);
  }

  forClass(classId: string): Show | null {
    const live = this.byClass.get(classId);
    if (!live) return null;
    // Gone quiet (the teacher's app closed or lost the network), or its video left the library: over.
    if (this.now() - live.heardAt > SHOW_STALE_MS || !this.content.get(live.item.id)) {
      this.byClass.delete(classId);
      return null;
    }
    return this.view(live);
  }

  // Ends shows that have gone quiet and tells their classes. Called on a timer by the server.
  sweep() {
    for (const [classId, live] of this.byClass) {
      if (this.now() - live.heardAt > SHOW_STALE_MS) {
        this.byClass.delete(classId);
        this.relay.notify(showRoom(classId));
      }
    }
  }

  private mine(actor: StaffPrincipal, id: string): Live {
    if (this.over.has(id)) throw new AppError(410, 'SHOW_OVER', 'This show has ended.');
    const live = [...this.byClass.values()].find((l) => l.id === id);
    if (!live || live.by !== actor.userId || !this.forClass(live.item.classId)) throw notFound('Show');
    return live;
  }

  private markOver(id: string) {
    this.over.add(id);
    // Only the latest few matter; an old id is never asked about again.
    if (this.over.size > 200) this.over.delete(this.over.values().next().value!);
  }

  private end(live: Live) {
    if (this.byClass.get(live.item.classId) === live) this.byClass.delete(live.item.classId);
    this.relay.notify(showRoom(live.item.classId));
  }

  private view(live: Live): Show {
    return { id: live.id, classId: live.item.classId, className: live.item.className, item: live.item, byName: live.byName, playing: live.playing, position: live.position, rate: live.rate, at: live.at, now: this.now() };
  }
}

// Where the video is by now, going by what the teacher last said.
const expected = (l: Live, now: number) => (l.playing ? l.position + ((now - l.at) / 1000) * l.rate : l.position);
