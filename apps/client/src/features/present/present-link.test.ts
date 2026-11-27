import { describe, expect, it } from 'vitest';
import type { SessionResult, Show } from '@ict/contracts';
import type { BoardWindow, Platform } from '../../platform/platform';
import { boardPlatform } from './board-platform';
import { hearConsole, PresentLink, type ToBoard } from './present-link';

// Two windows that hear each other, as the app's console and board window do.
function twoWindows() {
  const ears = { console: new Set<(m: unknown) => void>(), board: new Set<(m: unknown) => void>() };
  const closed = new Set<() => void>();
  const log = { opened: 0, closed: 0 };
  const side = (me: 'console' | 'board'): BoardWindow => ({
    isBoard: me === 'board',
    open: async () => { log.opened += 1; },
    close: async () => { log.closed += 1; for (const fn of closed) fn(); },
    say: async (m) => { for (const fn of ears[me === 'board' ? 'console' : 'board']) fn(m); },
    hear: (fn) => { ears[me].add(fn); return () => ears[me].delete(fn); },
    onClosed: (fn) => { closed.add(fn); return () => closed.delete(fn); },
  });
  return { console: side('console'), board: side('board'), log };
}

const teacher = { token: 'tok-1', principal: { kind: 'staff', displayName: 'Ravi' } } as unknown as SessionResult;
const student = { token: 'tok-2', principal: { kind: 'student', name: 'Asha' } } as unknown as SessionResult;
const video = { id: 'show-1', kind: 'video' } as unknown as Show;

// The link is tried without the checks on a message's shape: these fakes are not whole sessions.
function setUp() {
  const w = twoWindows();
  let clock = 1000;
  const link = new PresentLink(w.console, () => clock);
  link.attach();
  const got: ToBoard[] = [];
  const openBoard = () => w.board.hear((m) => { if (typeof m === 'object') got.push(m as ToBoard); });
  return { ...w, link, got, openBoard, tick: (ms: number) => { clock += ms; } };
}

describe('the console telling the board window what to show', () => {
  it('says nothing while no board window is open', () => {
    const { link, got, openBoard } = setUp();
    openBoard();
    link.setSession(teacher);
    link.setShow(video);
    expect(got).toEqual([]);
    expect(link.isOpen).toBe(false);
  });

  it('tells a board window that says hello who is signed in and what is shown, with its age', async () => {
    const { link, board, got, openBoard, tick } = setUp();
    link.setSession(teacher);
    link.setShow(video);
    tick(700);
    openBoard();
    await board.say('hello');
    expect(link.isOpen).toBe(true);
    expect(got).toEqual([{ session: teacher, show: video, showAge: 700 }]);
  });

  it('tells the board each change: a new show, and no show', async () => {
    const { link, got, openBoard } = setUp();
    link.setSession(teacher);
    await link.open();
    openBoard();
    link.setShow(video);
    link.setShow(video); // the same news is not said twice
    link.setShow(null);
    expect(got.map((g) => g.show)).toEqual([video, null]);
    expect(got.every((g) => g.showAge === 0)).toBe(true);
  });

  it('never hands a student session to the board', async () => {
    const { link, got, openBoard } = setUp();
    await link.open();
    openBoard();
    link.setSession(student);
    link.setShow(video);
    expect(got.every((g) => g.session === null)).toBe(true);
  });

  it('closes the board window when the teacher signs out, and forgets the show', async () => {
    const { link, log, board } = setUp();
    link.setSession(teacher);
    link.setShow(video);
    await link.open();
    link.setSession(null);
    await Promise.resolve();
    expect(log.closed).toBe(1);
    expect(link.isOpen).toBe(false);
    // The next teacher opens the board: nothing of the last lesson is told.
    const got: ToBoard[] = [];
    board.hear((m) => { if (typeof m === 'object') got.push(m as ToBoard); });
    await board.say('hello');
    expect(got).toEqual([{ session: null, show: null, showAge: 0 }]);
  });

  it('knows the board window is gone when the teacher closes it there', async () => {
    const { link, board } = setUp();
    const seen: boolean[] = [];
    link.onChange(() => seen.push(link.isOpen));
    await link.open();
    await board.close();
    expect(seen).toEqual([true, false]);
  });

  it('finds a board window that was already open when the console started', () => {
    const w = twoWindows();
    const heard: unknown[] = [];
    w.board.hear((m) => { heard.push(m); if (m === 'anyone') void w.board.say('hello'); });
    const link = new PresentLink(w.console);
    link.attach();
    expect(heard[0]).toBe('anyone');
    expect(link.isOpen).toBe(true);
  });

  it('stops hearing after detach', async () => {
    const { link, board } = setUp();
    link.detach();
    await board.say('hello');
    expect(link.isOpen).toBe(false);
  });
});

describe('the board window hearing the console', () => {
  it('says hello at once, answers "anyone", and passes on only news of the right shape', async () => {
    const w = twoWindows();
    const said: unknown[] = [];
    w.console.hear((m) => said.push(m));
    const news: ToBoard[] = [];
    const stop = hearConsole(w.board, (n) => news.push(n));
    expect(said).toEqual(['hello']);
    await w.console.say('anyone');
    expect(said).toEqual(['hello', 'hello']);
    await w.console.say({ session: null, show: null, showAge: 0 });
    await w.console.say({ nonsense: true });
    await w.console.say({ session: null, show: null, showAge: -5 });
    expect(news).toEqual([{ session: null, show: null, showAge: 0 }]);
    stop();
    await w.console.say({ session: null, show: null, showAge: 0 });
    expect(news).toHaveLength(1);
  });
});

describe('the platform as the board window may use it', () => {
  it('reads and fetches, but never changes what the console owns', async () => {
    const calls: string[] = [];
    const real = new Proxy({ appVersion: '1.0.0', present: twoWindows().board }, {
      get: (target, key: string) => (key in target ? (target as Record<string, unknown>)[key] : (...args: unknown[]) => { calls.push(key); return key === 'fileUrl' ? `file:${String(args[0])}` : Promise.resolve(null); }),
      has: () => true,
    }) as unknown as Platform;
    const guest = boardPlatform(real);

    await guest.saveSettings({ role: 'console' });
    await guest.clearSettings();
    expect(calls).toEqual([]);
    expect(guest.setFileSource).toBeUndefined();
    expect(guest.keepAlive).toBeUndefined();
    expect(guest.lockDown).toBeUndefined();

    await guest.loadSettings();
    await guest.relayOpen('https://10.0.0.5:7700', 'aa', 'tok');
    expect(guest.fileUrl?.('abc')).toBe('file:abc');
    expect(calls).toEqual(['loadSettings', 'relayOpen', 'fileUrl']);
    expect(guest.present?.isBoard).toBe(true);
  });
});
