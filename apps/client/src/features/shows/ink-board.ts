import { INK_BATCH_MAX, INK_POINTS_MAX, InkEvent, type Ink, type InkAdd, type InkColour, type InkStroke, type InkWidth } from '@ict/contracts';
import { tk } from '../../i18n/i18n';

// How the board talks to the server. Kept apart so the board can be tested without one.
export interface InkApi {
  all(): Promise<Ink>;
  add(body: InkAdd): Promise<void>;
  erase(strokeId: string): Promise<void>;
  // Wipes one page of the show.
  clear(page: number): Promise<void>;
}

// The pen's points are gathered and sent this often, not one request per point.
const SEND_EVERY_MS = 50;
// A number that does not fit is given this long to be explained by messages still on their way,
// before the board asks for all the writing again.
const SETTLE_MS = 1000;

// The writing on one show, on this screen. It hears every change the server sends and keeps the
// lines; and for whoever holds the pen here, it draws at once and sends the line on in small parts.
// `rev` is the server's count of changes. A change that is not the very next one means something was
// missed, and the board then asks for everything.
export class InkBoard {
  private strokes = new Map<string, InkStroke>();
  private rev = -1; // nothing known yet
  // Lines written on this screen. They are already drawn here, so the server's echo adds nothing.
  private mine = new Set<string>();
  private current: InkStroke | null = null;
  private outbox: InkAdd[] = [];
  private sending = false;
  private sendTimer: ReturnType<typeof setTimeout> | null = null;
  private settleTimer: ReturnType<typeof setTimeout> | null = null;
  private loading = false;
  private again = false;
  private closed = false;
  // The page of the show this screen is on. A video has only page 1.
  private page = 1;
  private listeners = new Set<() => void>();
  // Why the last line could not be written, in words for the screen.
  problem: string | null = null;

  constructor(
    private readonly showId: string,
    private readonly api: InkApi,
    private readonly me: { by: string; byName: string },
    private readonly newId: () => string = () => crypto.randomUUID(),
  ) {}

  // Only the lines of the page this screen is on.
  all(): Iterable<InkStroke> {
    return [...this.strokes.values()].filter((s) => s.page === this.page);
  }

  // Move to another page of the show. The lines of other pages stay kept, but are not drawn.
  setPage(page: number) {
    if (page === this.page) return;
    this.page = page;
    this.changed();
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  // Start and stop. Called from a React effect: in development React mounts, unmounts and mounts
  // again, so a board that was closed must work after it is opened once more.
  open() {
    this.closed = false;
  }

  close() {
    this.closed = true;
    for (const t of [this.sendTimer, this.settleTimer]) if (t) clearTimeout(t);
    this.sendTimer = this.settleTimer = null;
  }

  // --- hearing the server ---

  // The show says its writing is at change number `wanted`.
  expect(wanted: number) {
    if (this.closed || wanted <= this.rev) return;
    // Nothing known yet and nothing written yet: there is nothing to fetch.
    if (this.rev < 0 && wanted === 0) { this.rev = 0; return; }
    if (this.rev < 0) return void this.load();
    if (this.settleTimer) clearTimeout(this.settleTimer);
    this.settleTimer = setTimeout(() => { this.settleTimer = null; if (this.rev < wanted) void this.load(); }, SETTLE_MS);
  }

  // One change, as the server sent it.
  take(raw: unknown) {
    const parsed = InkEvent.safeParse(raw);
    if (this.closed || !parsed.success || parsed.data.show !== this.showId) return;
    const e = parsed.data;
    if (this.rev < 0 || e.rev > this.rev + 1) return void this.load();
    if (e.rev <= this.rev) return;
    this.rev = e.rev;
    if (e.kind === 'clear') this.forgetPage(e.page);
    if (e.kind === 'erase') this.forget(e.strokeId);
    if (e.kind === 'add' && !this.mine.has(e.stroke.id)) {
      const had = this.strokes.get(e.stroke.id);
      if (had) had.points.push(...e.stroke.points);
      else this.strokes.set(e.stroke.id, { ...e.stroke, points: [...e.stroke.points] });
    }
    this.changed();
  }

  private async load() {
    if (this.loading) { this.again = true; return; }
    this.loading = true;
    try {
      const ink = await this.api.all();
      if (this.closed) return;
      const fresh = new Map<string, InkStroke>();
      // A line still being written here is further along on this screen than on the server.
      for (const s of ink.strokes) fresh.set(s.id, (this.mine.has(s.id) && this.strokes.get(s.id)) || s);
      if (this.current && !fresh.has(this.current.id)) fresh.set(this.current.id, this.current);
      this.strokes = fresh;
      this.rev = Math.max(this.rev, ink.rev);
      this.changed();
    } catch {
      // The show may be over, or the network away. The next change or the next look tries again.
    } finally {
      this.loading = false;
      if (this.again && !this.closed) { this.again = false; void this.load(); }
    }
  }

  // --- writing ---

  // Pen down. Places and pressure are 0 to INK_SCALE.
  begin(colour: InkColour, width: InkWidth, x: number, y: number, pressure: number) {
    this.problem = null;
    const stroke: InkStroke = { id: this.newId(), ...this.me, page: this.page, colour, width, points: [x, y, pressure] };
    this.current = stroke;
    this.mine.add(stroke.id);
    this.strokes.set(stroke.id, stroke);
    this.outbox.push({ strokeId: stroke.id, page: stroke.page, colour, width, points: [x, y, pressure] });
    this.changed();
    this.soon();
  }

  // Pen moved.
  extend(x: number, y: number, pressure: number) {
    const stroke = this.current;
    if (!stroke) return;
    // A line as long as a line may be carries on as a new one, from the same spot.
    if (stroke.points.length >= INK_POINTS_MAX * 3) return this.begin(stroke.colour, stroke.width, x, y, pressure);
    stroke.points.push(x, y, pressure);
    const last = this.outbox.at(-1);
    if (last?.strokeId === stroke.id && last.points.length < INK_BATCH_MAX * 3) last.points.push(x, y, pressure);
    else this.outbox.push({ strokeId: stroke.id, page: stroke.page, colour: stroke.colour, width: stroke.width, points: [x, y, pressure] });
    this.changed();
    this.soon();
  }

  // Pen up.
  end() {
    this.current = null;
    void this.send();
  }

  // The line nearest to this spot, if one is within `reach`. With `onlyBy`, only that writer's lines.
  near(x: number, y: number, reach: number, onlyBy?: string): string | null {
    for (const s of [...this.all()].reverse()) {
      if (onlyBy && s.by !== onlyBy) continue;
      for (let i = 0; i < s.points.length; i += 3) {
        if (Math.hypot(s.points[i]! - x, s.points[i + 1]! - y) <= reach) return s.id;
      }
    }
    return null;
  }

  erase(strokeId: string) {
    if (!this.strokes.has(strokeId)) return;
    this.forget(strokeId);
    this.changed();
    this.api.erase(strokeId).catch(() => void this.load());
  }

  // Wipes the page this screen is on. The page is sent along: the server may not have heard of a
  // page turn made a moment ago, and must not wipe the page the teacher just left.
  clear() {
    const page = this.page;
    this.forgetPage(page);
    this.changed();
    this.api.clear(page).catch(() => void this.load());
  }

  private soon() {
    this.sendTimer ??= setTimeout(() => { this.sendTimer = null; void this.send(); }, SEND_EVERY_MS);
  }

  // One request at a time, so the parts of a line reach the server in the order they were drawn.
  private async send() {
    if (this.sending || this.closed) return;
    const part = this.outbox.shift();
    if (!part) return;
    this.sending = true;
    try {
      await this.api.add(part);
    } catch (e) {
      // The class never saw this line, so it must not stay on this screen either.
      this.problem = e instanceof Error ? e.message : tk('That could not be written.');
      this.forget(part.strokeId);
      this.changed();
    } finally {
      this.sending = false;
      if (this.outbox.length) void this.send();
    }
  }

  private forget(strokeId: string) {
    this.strokes.delete(strokeId);
    this.mine.delete(strokeId);
    this.outbox = this.outbox.filter((p) => p.strokeId !== strokeId);
    if (this.current?.id === strokeId) this.current = null;
  }

  private forgetPage(page: number) {
    for (const s of [...this.strokes.values()]) if (s.page === page) this.forget(s.id);
  }

  private changed() {
    for (const fn of this.listeners) fn();
  }
}
