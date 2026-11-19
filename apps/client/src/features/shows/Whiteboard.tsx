import { useEffect, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, MonitorPlay, Plus } from 'lucide-react';
import { WHITEBOARD_ASPECT, WHITEBOARD_PAGES_MAX, type SchoolClass } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, ErrorNote, Select, useAction } from '../../ui/ui';
import { InkLayer, InkToolbar, useInk, useInkProblem, type InkTools } from './Ink';
import { PenRow } from './PenRow';
import { turnPage } from './show-pages';
import { useShowHost } from './useShowHost';

// A blank board the teacher shows to one class and writes on, page by page. Every student PC of the
// class shows the page she is on. The board lives only while it is shown: leaving this screen, or
// "Stop showing", ends it and its writing.
export function Whiteboard({ onBack }: { onBack: () => void }) {
  const { call, state } = useApp();
  const me = state.session?.principal;
  const myName = me?.kind === 'staff' ? me.displayName : '';

  // --- Which class sees it ---
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [picked, setPickedClass] = useState('');
  const load = useAction(async () => setClasses(await call('GET /api/v1/classes')));
  const { run: loadNow } = load;
  useEffect(() => { void loadNow(); }, [loadNow]);
  // A teacher with one class need not choose.
  const classId = picked || (classes.length === 1 ? classes[0]!.id : '');

  const host = useShowHost({ whiteboard: true, classId });
  const { showing, live } = host;

  // --- Pages ---
  // The page the teacher is on, for the show it belongs to. A new show (or the same board started
  // again after the server lost it) is blank at page 1 of 1.
  const [at, setAt] = useState({ id: '', page: 1, pages: 1 });
  const here = live && at.id === live.id ? at : { id: live?.id ?? '', page: 1, pages: 1 };
  const go = (by: number) => {
    const page = turnPage(here.page, by, here.pages);
    if (page === here.page) return;
    setAt({ ...here, page });
    host.turn(page);
  };
  const addPage = () => {
    const pages = here.pages + 1;
    setAt({ ...here, page: pages, pages });
    host.turn(pages, pages);
  };

  // --- Writing ---
  const board = useInk(showing ? live : null, 'teacher', myName, here.page);
  const inkProblem = useInkProblem(board);
  const [tools, setTools] = useState<InkTools>({ tool: 'pen', colour: 'blue', width: 'medium' });

  return (
    // The whole window: one slim row of buttons on top, and under it the board as big as fits.
    <div className="flex h-full w-full flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="quiet" onClick={onBack}><ArrowLeft className="size-4" /> Back</Button>
        <h1 className="min-w-48 flex-1 font-display text-2xl font-semibold">Whiteboard</h1>
        {showing ? (
          <div className="flex flex-wrap items-center gap-3" role="status">
            <span className="flex h-11 items-center gap-2 rounded-full bg-primary/10 px-5 text-base font-semibold text-primary"><MonitorPlay className="size-5 shrink-0" /> Class {live?.className} can see this board now</span>
            <PenRow host={host} />
          <Button variant="quiet" disabled={host.busy.stop} onClick={() => host.stop()}>Stop showing</Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3" title="A blank board opens on every student PC of the class.">
          <Select aria-label="Class to show the whiteboard to" className="w-auto rounded-full !text-base" value={classId} onChange={(e) => setPickedClass(e.target.value)}>
            <option value="">Choose a class</option>
            {classes.map((c) => <option key={c.id} value={c.id}>Class {c.name}</option>)}
          </Select>
          <Button disabled={!classId || host.busy.start} onClick={() => host.start()}><MonitorPlay className="size-4" /> Start whiteboard</Button>
          </div>
        )}
      </div>
      <ErrorNote message={load.error ?? host.error ?? inkProblem} />

      {/* The board in the middle, as big as fits at its wide shape; the pen down its left side and the
          page buttons down its right, so none of the window's height is spent on them. */}
      <div className="flex min-h-0 flex-1 gap-3">
        {showing && (
          <div className="flex shrink-0 flex-col items-center justify-center rounded-2xl bg-[hsl(222_30%_10%)] px-1.5 py-3">
            <InkToolbar vertical tools={tools} onTools={setTools} onWipe={() => board?.clear()} />
          </div>
        )}
        <div className="grid min-h-64 min-w-0 flex-1 place-items-center [container-type:size]">
          <div className="relative aspect-video w-[min(100cqw,calc(100cqh*16/9))] rounded-2xl bg-white ring-1 ring-border">
            <InkLayer board={board} aspect={WHITEBOARD_ASPECT} tools={showing ? tools : { ...tools, tool: null }} />
          </div>
        </div>
        {showing && (
          <div className="flex w-36 shrink-0 flex-col items-stretch justify-center gap-3">
            <Button variant="quiet" className="min-h-20 flex-col text-base" disabled={here.page <= 1} onClick={() => go(-1)}><ChevronLeft className="size-6" /> Previous</Button>
            <span className="text-center text-lg font-semibold tabular-nums" role="status">Page {here.page} of {here.pages}</span>
            <Button className="min-h-20 flex-col text-base" disabled={here.page >= here.pages} onClick={() => go(1)}><ChevronRight className="size-6" /> Next</Button>
            <Button variant="quiet" className="min-h-16 flex-col text-base" disabled={here.pages >= WHITEBOARD_PAGES_MAX} onClick={addPage}><Plus className="size-5" /> Add page</Button>
          </div>
        )}
      </div>
    </div>
  );
}
