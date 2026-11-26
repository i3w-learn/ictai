import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INK_BATCH_MAX, INK_POINTS_MAX, type Ink, type InkAdd } from '@ict/contracts';
import { InkBoard } from './ink-board';

const SHOW = 'show-1';
const line = (id: string, points: number[], by = 'teacher', page = 1) => ({ id, by, byName: 'Ravi', page, colour: 'red' as const, width: 'medium' as const, points });

// A board with a fake server: what was sent is recorded, and `server` is what "all the writing" returns.
function setup(by = 'teacher') {
  const sent: InkAdd[] = [];
  const erased: string[] = [];
  let fail: Error | null = null;
  const server: Ink = { rev: 0, strokes: [] };
  const api = {
    all: vi.fn(async () => structuredClone(server)),
    add: vi.fn(async (body: InkAdd) => { if (fail) throw fail; sent.push(structuredClone(body)); }),
    erase: vi.fn(async (id: string) => { erased.push(id); }),
    clear: vi.fn(async (_page: number) => undefined),
  };
  let n = 0;
  const board = new InkBoard(SHOW, api, { by, byName: 'Me' }, () => `mine-${++n}`);
  const drawn = () => [...board.all()].map((s) => ({ id: s.id, points: s.points }));
  return { board, api, sent, erased, server, drawn, failWith: (e: Error | null) => { fail = e; } };
}

describe('InkBoard', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('draws a line as its parts arrive, one after the other', () => {
    const { board, drawn, api } = setup();
    board.expect(0);
    board.take({ kind: 'add', show: SHOW, rev: 1, stroke: line('a', [1, 1, 1]) });
    board.take({ kind: 'add', show: SHOW, rev: 2, stroke: line('a', [2, 2, 2]) });
    expect(drawn()).toEqual([{ id: 'a', points: [1, 1, 1, 2, 2, 2] }]);
    board.take({ kind: 'add', show: SHOW, rev: 2, stroke: line('a', [2, 2, 2]) }); // the same part twice
    board.take({ kind: 'add', show: 'another-show', rev: 3, stroke: line('b', [9, 9, 9]) });
    expect(drawn()).toEqual([{ id: 'a', points: [1, 1, 1, 2, 2, 2] }]);
    board.take({ kind: 'erase', show: SHOW, rev: 3, strokeId: 'a' });
    expect(drawn()).toEqual([]);
    expect(api.all).not.toHaveBeenCalled(); // nothing was missed, so nothing was asked for
  });

  it('asks for all the writing when a change was missed', async () => {
    const { board, drawn, server, api } = setup();
    board.expect(0);
    board.take({ kind: 'add', show: SHOW, rev: 1, stroke: line('a', [1, 1, 1]) });
    Object.assign(server, { rev: 3, strokes: [line('a', [1, 1, 1, 2, 2, 2]), line('b', [5, 5, 5])] });
    board.take({ kind: 'add', show: SHOW, rev: 3, stroke: line('b', [5, 5, 5]) }); // 2 never came
    await vi.advanceTimersByTimeAsync(0);
    expect(api.all).toHaveBeenCalledTimes(1);
    expect(drawn()).toEqual([{ id: 'a', points: [1, 1, 1, 2, 2, 2] }, { id: 'b', points: [5, 5, 5] }]);
    board.take({ kind: 'clear', show: SHOW, rev: 4, page: 1 });
    expect(drawn()).toEqual([]);
  });

  it('fetches the writing for a screen that comes late, and waits a moment before doubting the live channel', async () => {
    const { board, drawn, server, api } = setup();
    Object.assign(server, { rev: 2, strokes: [line('a', [1, 1, 1])] });
    board.expect(2); // joined a show that already has writing
    await vi.advanceTimersByTimeAsync(0);
    expect(drawn()).toEqual([{ id: 'a', points: [1, 1, 1] }]);

    // A look at the show says 3, and the change arrives a moment later: no need to ask again.
    board.expect(3);
    board.take({ kind: 'add', show: SHOW, rev: 3, stroke: line('a', [2, 2, 2]) });
    await vi.advanceTimersByTimeAsync(2000);
    expect(api.all).toHaveBeenCalledTimes(1);

    // A look says 4 and nothing arrives: the live channel is down, so ask.
    Object.assign(server, { rev: 4, strokes: [] });
    board.expect(4);
    await vi.advanceTimersByTimeAsync(2000);
    expect(api.all).toHaveBeenCalledTimes(2);
    expect(drawn()).toEqual([]);
  });

  it('draws the pen at once and sends the line on in small parts, in order', async () => {
    const { board, drawn, sent } = setup();
    board.expect(0);
    const changes = vi.fn();
    board.onChange(changes);
    board.begin('blue', 'thick', 1, 1, 5000);
    board.extend(2, 2, 5000);
    expect(drawn()).toEqual([{ id: 'mine-1', points: [1, 1, 5000, 2, 2, 5000] }]); // on the screen before anything is sent
    expect(changes).toHaveBeenCalledTimes(2);
    expect(sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(50);
    expect(sent).toEqual([{ strokeId: 'mine-1', page: 1, colour: 'blue', width: 'thick', points: [1, 1, 5000, 2, 2, 5000] }]);
    board.extend(3, 3, 5000);
    board.end();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent[1]).toEqual({ strokeId: 'mine-1', page: 1, colour: 'blue', width: 'thick', points: [3, 3, 5000] });
    // The server's echo of the writer's own line is not drawn a second time.
    board.take({ kind: 'add', show: SHOW, rev: 1, stroke: line('mine-1', [1, 1, 5000, 2, 2, 5000]) });
    expect(drawn()).toEqual([{ id: 'mine-1', points: [1, 1, 5000, 2, 2, 5000, 3, 3, 5000] }]);
  });

  it('keeps each message and each line within what the server takes', async () => {
    const { board, drawn, sent } = setup();
    board.expect(0);
    board.begin('red', 'thin', 0, 0, 1);
    for (let i = 1; i < INK_POINTS_MAX + 10; i += 1) board.extend(i, i, 1);
    board.end();
    await vi.advanceTimersByTimeAsync(100);
    expect(Math.max(...sent.map((p) => p.points.length))).toBeLessThanOrEqual(INK_BATCH_MAX * 3);
    // The long line carried on as a second one.
    expect(drawn().map((s) => s.points.length / 3)).toEqual([INK_POINTS_MAX, 10]);
    expect(sent.flatMap((p) => p.points)).toHaveLength((INK_POINTS_MAX + 10) * 3);
  });

  it('takes a line off the screen when the server would not have it, and says why', async () => {
    const { board, drawn, failWith } = setup('asha');
    board.expect(0);
    failWith(new Error('Your teacher has not given you the pen.'));
    board.begin('red', 'thin', 1, 1, 1);
    board.extend(2, 2, 1);
    await vi.advanceTimersByTimeAsync(50);
    expect(drawn()).toEqual([]);
    expect(board.problem).toBe('Your teacher has not given you the pen.');
    board.extend(3, 3, 1); // the pen is still moving; nothing more is drawn
    expect(drawn()).toEqual([]);
    failWith(null);
    board.begin('red', 'thin', 4, 4, 1);
    expect(board.problem).toBeNull();
  });

  it('rubs out the line under the rubber, and for a student only their own', () => {
    const { board, drawn, erased } = setup('asha');
    board.expect(0);
    board.take({ kind: 'add', show: SHOW, rev: 1, stroke: line('teachers', [100, 100, 1]) });
    board.take({ kind: 'add', show: SHOW, rev: 2, stroke: line('ashas', [5000, 5000, 1], 'asha') });
    expect(board.near(110, 100, 50)).toBe('teachers');
    expect(board.near(110, 100, 50, 'asha')).toBeNull();
    expect(board.near(9000, 9000, 50)).toBeNull();
    board.erase(board.near(5010, 5000, 50, 'asha')!);
    expect(erased).toEqual(['ashas']);
    expect(drawn().map((s) => s.id)).toEqual(['teachers']);
  });

  it('drops what is being written when the board is wiped', async () => {
    const { board, drawn, sent } = setup();
    board.expect(0);
    board.begin('red', 'thin', 1, 1, 1);
    board.take({ kind: 'clear', show: SHOW, rev: 1, page: 1 }); // the teacher pressed play
    board.extend(2, 2, 1);
    await vi.advanceTimersByTimeAsync(100);
    expect(drawn()).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('works again after being closed and opened, as React does to it in development', async () => {
    const { board, drawn, sent } = setup();
    const changes = vi.fn();
    board.onChange(changes);
    board.close();
    board.take({ kind: 'add', show: SHOW, rev: 1, stroke: line('a', [1, 1, 1]) });
    expect(drawn()).toEqual([]); // closed: hears nothing
    board.open();
    board.expect(0);
    board.take({ kind: 'add', show: SHOW, rev: 1, stroke: line('a', [1, 1, 1]) });
    board.begin('red', 'thin', 2, 2, 1);
    await vi.advanceTimersByTimeAsync(50);
    expect(drawn().map((s) => s.id)).toEqual(['a', 'mine-1']);
    expect(sent).toHaveLength(1);
    expect(changes).toHaveBeenCalled();
  });

  it('draws only the lines of the page it is on', async () => {
    const { board, drawn, server } = setup();
    Object.assign(server, { rev: 2, strokes: [line('a', [1, 1, 1], 'teacher', 1), line('b', [2, 2, 2], 'teacher', 7)] });
    board.expect(2);
    await vi.advanceTimersByTimeAsync(0);
    expect(drawn().map((s) => s.id)).toEqual(['a']);
    board.setPage(7);
    expect(drawn().map((s) => s.id)).toEqual(['b']);
    board.setPage(1);
    expect(drawn().map((s) => s.id)).toEqual(['a']);
  });

  it('writes new lines on the current page', async () => {
    const { board, sent } = setup();
    board.setPage(3);
    board.begin('red', 'medium', 1, 1, 1);
    board.end();
    await vi.advanceTimersByTimeAsync(0);
    expect(sent[0]!.page).toBe(3);
  });

  it('wipes only the current page when the server says so', () => {
    const { board, drawn } = setup();
    board.expect(0);
    board.take({ kind: 'add', show: SHOW, rev: 1, stroke: line('a', [1, 1, 1], 'teacher', 1) });
    board.take({ kind: 'add', show: SHOW, rev: 2, stroke: line('b', [2, 2, 2], 'teacher', 2) });
    board.take({ kind: 'clear', show: SHOW, rev: 3, page: 2 });
    expect(drawn().map((s) => s.id)).toEqual(['a']);
    board.setPage(2);
    expect(drawn()).toEqual([]);
  });

  it('wipes only the current page when this screen wipes', () => {
    const { board, drawn, api } = setup();
    board.expect(0);
    board.take({ kind: 'add', show: SHOW, rev: 1, stroke: line('a', [1, 1, 1], 'teacher', 1) });
    board.take({ kind: 'add', show: SHOW, rev: 2, stroke: line('b', [2, 2, 2], 'teacher', 2) });
    board.setPage(2);
    board.clear();
    expect(api.clear).toHaveBeenCalledWith(2); // the page on this screen, not whatever the server is on
    expect(drawn()).toEqual([]);
    board.setPage(1);
    expect(drawn().map((s) => s.id)).toEqual(['a']);
  });

  it('changes its picture when the page changes', () => {
    const { board } = setup();
    const heard = vi.fn();
    board.onChange(heard);
    board.setPage(2);
    expect(heard).toHaveBeenCalledTimes(1);
    board.setPage(2);
    expect(heard).toHaveBeenCalledTimes(1);
  });
});
