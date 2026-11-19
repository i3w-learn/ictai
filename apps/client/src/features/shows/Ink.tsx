import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type PointerEvent } from 'react';
import { Eraser, Pencil, Trash2 } from 'lucide-react';
import { INK_COLOURS, INK_SCALE, INK_WIDTHS, Show, showRoom, type InkColour, type InkStroke, type InkWidth } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { cn } from '../../ui/ui';
import { InkBoard } from './ink-board';

const PAINT: Record<InkColour, string> = { red: '#ff453a', yellow: '#ffd60a', green: '#30d158', blue: '#0a84ff', white: '#ffffff' };
// How thick a line is, as a share of the picture's width, at a middling press.
const THICK: Record<InkWidth, number> = { thin: 0.003, medium: 0.006, thick: 0.012 };
const WIDTH_WORDS: Record<InkWidth, string> = { thin: 'Thin', medium: 'Medium', thick: 'Thick' };
// The dark rim round every line, so that it shows on any colour of video.
// Solid, not see-through: a line is many short parts, and see-through parts would darken where they meet.
const RIM = '#1a1a1a';
// A mouse cannot say how hard it is pressed.
const EVEN_PRESS = INK_SCALE / 2;
// How near the rubber must come to a line, as a share of the picture.
const RUB_REACH = INK_SCALE * 0.02;

export interface InkTools { tool: 'pen' | 'eraser' | null; colour: InkColour; width: InkWidth }

// The writing on the show `show`, kept in step with the server for as long as the screen is up.
// `me` is who writes on this screen: 'teacher', or the student's id. The board is on the show's page,
// or on `page` when given: the teacher's screen passes its own page, so her writing goes on the page in
// front of her the moment she turns, not when the server's answer comes back.
export function useInk(show: { id: string; classId: string; inkRev: number; page: number } | null, by: string, byName: string, page?: number): InkBoard | null {
  const { relay, call } = useApp();
  const id = show?.id ?? null;
  const classId = show?.classId ?? null;
  const board = useMemo(() => {
    if (!id) return null;
    const params = { id };
    return new InkBoard(id, {
      all: () => call('GET /api/v1/shows/:id/ink', { params }),
      add: (body) => call('POST /api/v1/shows/:id/ink', { params, body }),
      erase: (strokeId) => call('DELETE /api/v1/shows/:id/ink/:strokeId', { params: { id, strokeId } }),
      clear: () => call('DELETE /api/v1/shows/:id/ink', { params }),
    }, { by, byName });
  }, [call, id, by, byName]);

  useEffect(() => {
    if (!board || !classId) return;
    const room = showRoom(classId);
    board.open();
    const leave = relay.subscribe(room, (state) => {
      const parsed = Show.nullable().safeParse(state);
      if (parsed.success && parsed.data?.id === id) board.expect(parsed.data.inkRev);
    });
    const deaf = relay.listen(room, (event) => board.take(event));
    return () => { leave(); deaf(); board.close(); };
  }, [board, relay, classId, id]);

  // The number also comes with every look at the show, which keeps the writing right when the live
  // channel is down for a while.
  const rev = show?.inkRev ?? 0;
  useEffect(() => board?.expect(rev), [board, rev]);
  const on = page ?? show?.page ?? 1;
  useEffect(() => board?.setPage(on), [board, on]);
  return board;
}

// Why the last line could not be written (the pen was taken back, say), or null.
export function useInkProblem(board: InkBoard | null): string | null {
  const watch = useCallback((fn: () => void) => board?.onChange(fn) ?? (() => undefined), [board]);
  return useSyncExternalStore(watch, () => board?.problem ?? null);
}

// Where the video's picture really is inside its box. A video is shown whole, with black bars at
// the sides or above and below when the box has another shape.
function pictureIn(boxW: number, boxH: number, aspect: number) {
  const width = Math.min(boxW, boxH * aspect);
  const height = width / aspect;
  return { left: (boxW - width) / 2, top: (boxH - height) / 2, width, height };
}

function paint(ctx: CanvasRenderingContext2D, strokes: Iterable<InkStroke>, w: number, h: number) {
  ctx.clearRect(0, 0, w, h);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  const px = (n: number) => (n / INK_SCALE) * w;
  const py = (n: number) => (n / INK_SCALE) * h;
  // A student's writing carries their name, once, where they first put the pen down, so that the
  // teacher and the class can tell whose it is.
  const named = new Set<string>();
  const tags: { name: string; x: number; y: number }[] = [];
  for (const s of strokes) {
    if (s.by !== 'teacher' && !named.has(s.by) && s.points.length) {
      named.add(s.by);
      tags.push({ name: s.byName, x: px(s.points[0]!), y: py(s.points[1]!) });
    }
    const p = s.points;
    const base = THICK[s.width] * w;
    // Pressed lightly the line is thin, pressed hard it is thick, as with a real pen.
    const thick = (i: number) => base * (0.4 + 1.2 * (p[i + 2]! / INK_SCALE));
    // Each line is drawn twice: first a little wider in a dark shade, then in its own
    // colour on top. The dark rim keeps a red line readable on a red part of the video, a white line
    // on a white page, and so on. It is all of one line before the colour, so no rim cuts across it.
    const rim = Math.max(1.5, base * 0.3);
    for (const edge of [rim, 0]) {
      ctx.strokeStyle = ctx.fillStyle = edge ? RIM : PAINT[s.colour];
      if (p.length === 3) {
        ctx.beginPath();
        ctx.arc(px(p[0]!), py(p[1]!), thick(0) / 2 + edge, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      // Each part is a gentle curve from the middle of one step to the middle of the next, so a
      // line drawn fast does not come out as straight bits with corners.
      let fromX = px(p[0]!);
      let fromY = py(p[1]!);
      for (let i = 3; i < p.length; i += 3) {
        const x0 = px(p[i - 3]!), y0 = py(p[i - 2]!), x1 = px(p[i]!), y1 = py(p[i + 1]!);
        const last = i + 3 >= p.length;
        const toX = last ? x1 : (x0 + x1) / 2;
        const toY = last ? y1 : (y0 + y1) / 2;
        ctx.lineWidth = (thick(i - 3) + thick(i)) / 2 + edge * 2;
        ctx.beginPath();
        ctx.moveTo(fromX, fromY);
        ctx.quadraticCurveTo(x0, y0, toX, toY);
        ctx.stroke();
        fromX = toX;
        fromY = toY;
      }
    }
  }
  const letters = Math.max(11, w * 0.016);
  ctx.font = `600 ${letters}px system-ui, sans-serif`;
  ctx.textBaseline = 'middle';
  for (const t of tags) {
    const pad = letters * 0.5;
    const wide = ctx.measureText(t.name).width + pad * 2;
    const tall = letters * 1.7;
    // Above the first touch, and kept inside the picture.
    const x = Math.min(Math.max(0, t.x), w - wide);
    const y = t.y - tall * 1.4 < 0 ? t.y + tall * 0.4 : t.y - tall * 1.4;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
    ctx.beginPath();
    ctx.roundRect(x, y, wide, tall, tall / 2);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.fillText(t.name, x + pad, y + tall / 2);
  }
}

// The see-through sheet over the video's picture. Everyone sees the writing on it; whoever has a
// tool in hand (`tools.tool`) can write or rub out. `aspect` is the picture's width over its height.
// `onPenDown` is called as the pen touches down (the teacher's video pauses then). With `own`, the
// rubber takes only that writer's lines.
export function InkLayer({ board, aspect, tools, onPenDown, own }: { board: InkBoard | null; aspect: number | null; tools: InkTools; onPenDown?: () => void; own?: string }) {
  const box = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const down = useRef(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const seen = new ResizeObserver(() => setSize({ w: el.clientWidth, h: el.clientHeight }));
    seen.observe(el);
    return () => seen.disconnect();
  }, []);

  const at = aspect && size.w && size.h ? pictureIn(size.w, size.h, aspect) : null;
  const pw = at ? Math.round(at.width) : 0;
  const ph = at ? Math.round(at.height) : 0;

  // Paint again whenever the writing changes or the picture changes size; at most once a frame.
  useEffect(() => {
    const c = canvas.current;
    if (!c || !pw || !ph) return;
    const sharp = window.devicePixelRatio || 1;
    // Setting the size also wipes the sheet, so writing from a show that has ended does not stay behind.
    c.width = Math.round(pw * sharp);
    c.height = Math.round(ph * sharp);
    if (!board) return;
    let frame = 0;
    const draw = () => { frame = 0; const ctx = c.getContext('2d'); if (ctx) paint(ctx, board.all(), c.width, c.height); };
    const ask = () => { frame ||= requestAnimationFrame(draw); };
    ask();
    const stop = board.onChange(ask);
    return () => { stop(); if (frame) cancelAnimationFrame(frame); };
  }, [board, pw, ph]);

  const spot = (e: { clientX: number; clientY: number; pressure: number; pointerType: string }) => {
    const r = canvas.current!.getBoundingClientRect();
    const part = (n: number) => Math.round(Math.min(1, Math.max(0, n)) * INK_SCALE);
    const press = e.pointerType === 'mouse' || !e.pressure ? EVEN_PRESS : part(e.pressure);
    return [part((e.clientX - r.left) / r.width), part((e.clientY - r.top) / r.height), press] as const;
  };
  const rub = (e: PointerEvent) => {
    const [x, y] = spot(e);
    const hit = board?.near(x, y, RUB_REACH, own);
    if (hit) board!.erase(hit);
  };
  const onDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!board || !tools.tool || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    down.current = true;
    if (tools.tool === 'eraser') return rub(e);
    onPenDown?.();
    board.begin(tools.colour, tools.width, ...spot(e));
  };
  const onMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!board || !down.current) return;
    if (tools.tool === 'eraser') return rub(e);
    // A fast pen reports several places between two frames; taking them all keeps the line round.
    const steps = e.nativeEvent.getCoalescedEvents?.() ?? [];
    for (const step of steps.length ? steps : [e.nativeEvent]) board.extend(...spot(step));
  };
  const onUp = () => {
    if (!down.current) return;
    down.current = false;
    board?.end();
  };

  return (
    <div ref={box} className="pointer-events-none absolute inset-0">
      {at && (
        <canvas
          ref={canvas} aria-hidden="true"
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
          className={cn('absolute touch-none', tools.tool ? 'pointer-events-auto' : 'pointer-events-none', tools.tool === 'pen' && 'cursor-crosshair', tools.tool === 'eraser' && 'cursor-cell')}
          style={{ left: at.left, top: at.top, width: pw, height: ph }}
        />
      )}
    </div>
  );
}

// The pen, its colours and sizes, the rubber, and (for the teacher) "wipe all". Made for a dark bar.
export function InkToolbar({ tools, onTools, onWipe }: { tools: InkTools; onTools: (t: InkTools) => void; onWipe?: () => void }) {
  const Round = 'grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-white hover:bg-white/15 focus-visible:outline-white';
  const pick = (tool: 'pen' | 'eraser') => onTools({ ...tools, tool: tools.tool === tool ? null : tool });
  return (
    <div className="flex flex-wrap items-center gap-1" role="toolbar" aria-label="Pen tools">
      <button type="button" className={cn(Round, tools.tool === 'pen' && 'bg-white/25')} onClick={() => pick('pen')} aria-pressed={tools.tool === 'pen'} aria-label="Pen: write on the page"><Pencil className="size-5" /></button>
      {tools.tool === 'pen' && (
        <>
          {INK_COLOURS.map((c) => (
            <button key={c} type="button" onClick={() => onTools({ ...tools, colour: c })} aria-pressed={tools.colour === c} aria-label={`${c} pen`} className="grid size-9 shrink-0 cursor-pointer place-items-center rounded-full hover:bg-white/15 focus-visible:outline-white">
              <span className={cn('size-5 rounded-full border border-black/40', tools.colour === c && 'ring-2 ring-white ring-offset-2 ring-offset-black')} style={{ background: PAINT[c] }} />
            </button>
          ))}
          {INK_WIDTHS.map((w, i) => (
            <button key={w} type="button" onClick={() => onTools({ ...tools, width: w })} aria-pressed={tools.width === w} aria-label={`${WIDTH_WORDS[w]} line`} className={cn('grid size-9 shrink-0 cursor-pointer place-items-center rounded-full hover:bg-white/15 focus-visible:outline-white', tools.width === w && 'bg-white/25')}>
              <span className="rounded-full bg-white" style={{ width: 4 + i * 4, height: 4 + i * 4 }} />
            </button>
          ))}
        </>
      )}
      <button type="button" className={cn(Round, tools.tool === 'eraser' && 'bg-white/25')} onClick={() => pick('eraser')} aria-pressed={tools.tool === 'eraser'} aria-label="Rubber: touch a line to rub it out"><Eraser className="size-5" /></button>
      {onWipe && <button type="button" className={Round} onClick={onWipe} aria-label="Wipe all the writing"><Trash2 className="size-5" /></button>}
    </div>
  );
}
