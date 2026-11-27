import { SessionResult, Show } from '@ict/contracts';
import { z } from 'zod';
import type { BoardWindow } from '../../platform/platform';

// What the console tells the board window: who is signed in, and what is being shown to a class
// right now. `showAge` is how long ago (ms) the console heard that from the server, so the board's
// video can be put at the right place even when the news reaches it late.
export const ToBoard = z.object({
  session: SessionResult.nullable(),
  show: Show.nullable(),
  showAge: z.number().nonnegative(),
});
export type ToBoard = z.infer<typeof ToBoard>;
// What the board window tells the console: "I am open; tell me everything".
const HELLO = 'hello';
// And what the console asks when it starts: "is a board window already open?".
const ANYONE = 'anyone';

// The console's side of the board window. It remembers the newest session and show, and tells the
// board window whenever one changes or the board window (re)opens.
export class PresentLink {
  private session: SessionResult | null = null;
  private show: Show | null = null;
  private showAt = 0;
  private open_ = false;
  private listeners = new Set<() => void>();
  private stops: (() => void)[] = [];

  constructor(
    private readonly board: BoardWindow,
    private readonly now: () => number = () => performance.now(),
  ) {}

  // Start and stop hearing the board window. Call from a React effect.
  attach() {
    if (this.stops.length) return;
    this.stops = [
      this.board.hear((m) => { if (m === HELLO) { this.setOpen(true); this.tell(); } }),
      this.board.onClosed(() => this.setOpen(false)),
    ];
    // A board window left open from before this page loaded answers with "hello".
    void this.board.say(ANYONE).catch(() => undefined);
  }

  detach() {
    for (const stop of this.stops) stop();
    this.stops = [];
  }

  get isOpen() {
    return this.open_;
  }

  onChange(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  async open() {
    await this.board.open();
    this.setOpen(true);
  }

  async close() {
    await this.board.close();
    this.setOpen(false);
  }

  // Only staff use the board window. Signing out closes it: the next person must not find the last
  // teacher's lesson on the board.
  setSession(session: SessionResult | null) {
    const staff = session?.principal.kind === 'staff' ? session : null;
    if (staff?.token === this.session?.token && staff?.principal === this.session?.principal) return;
    const signedOut = !!this.session && !staff;
    this.session = staff;
    if (signedOut) { this.show = null; if (this.open_) void this.close().catch(() => undefined); return; }
    this.tell();
  }

  setShow(show: Show | null) {
    if (show === this.show) return;
    this.show = show;
    this.showAt = this.now();
    this.tell();
  }

  private tell() {
    if (!this.open_) return;
    const message: ToBoard = { session: this.session, show: this.show, showAge: this.show ? Math.max(0, this.now() - this.showAt) : 0 };
    void this.board.say(message).catch(() => undefined);
  }

  private setOpen(open: boolean) {
    if (open === this.open_) return;
    this.open_ = open;
    for (const fn of this.listeners) fn();
  }
}

// The board window's side: says hello, and hands on what the console tells it.
export function hearConsole(board: BoardWindow, take: (news: ToBoard) => void): () => void {
  const stop = board.hear((m) => {
    if (m === ANYONE) return void board.say(HELLO).catch(() => undefined);
    const news = ToBoard.safeParse(m);
    if (news.success) take(news.data);
  });
  void board.say(HELLO).catch(() => undefined);
  return stop;
}
