import { useEffect, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, MonitorPlay, Plus } from 'lucide-react';
import { WHITEBOARD_ASPECT, WHITEBOARD_PAGES_MAX, type SchoolClass } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, ErrorNote, Select, useAction } from '../../ui/ui';
import { InkLayer, InkToolbar, useInk, useInkProblem, type InkTools } from './Ink';
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
  const board = useInk(showing ? live : null, 'teacher', myName);
  const inkProblem = useInkProblem(board);
  const [tools, setTools] = useState<InkTools>({ tool: 'pen', colour: 'blue', width: 'medium' });
  const watching = live?.watching ?? [];

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="quiet" onClick={onBack}><ArrowLeft className="size-4" /> Back</Button>
        <h1 className="min-w-48 flex-1 font-display text-2xl font-semibold">Whiteboard</h1>
      </div>

      {showing ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/40 bg-primary/10 px-4 py-3" role="status">
          <MonitorPlay className="size-5 shrink-0 text-primary" />
          <p className="min-w-56 flex-1"><b>Class {live?.className} can see this board now.</b> What you write, and the page you are on, they see too.</p>
          {live?.pen ? (
            <>
              <span><b>{live.pen.name}</b> has the pen.</span>
              <Button variant="quiet" disabled={host.busy.pen} onClick={() => host.givePen(null)}>Take the pen back</Button>
            </>
          ) : (
            <Select aria-label="Give the pen to a student" className="w-auto" value="" disabled={host.busy.pen || watching.length === 0} onChange={(e) => { if (e.target.value) void host.givePen(e.target.value); }}>
              <option value="">{watching.length ? 'Give the pen to…' : 'No student screen has it open yet'}</option>
              {watching.map((w) => <option key={w.studentId} value={w.studentId}>{w.name}</option>)}
            </Select>
          )}
          <Button variant="quiet" disabled={host.busy.stop} onClick={() => host.stop()}>Stop showing</Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-3">
          <Select aria-label="Class to show the whiteboard to" className="w-auto" value={classId} onChange={(e) => setPickedClass(e.target.value)}>
            <option value="">Choose a class</option>
            {classes.map((c) => <option key={c.id} value={c.id}>Class {c.name}</option>)}
          </Select>
          <Button disabled={!classId || host.busy.start} onClick={() => host.start()}><MonitorPlay className="size-4" /> Start whiteboard</Button>
          <span className="text-sm text-muted-foreground">A blank board opens on every student PC of the class.</span>
        </div>
      )}
      <ErrorNote message={load.error ?? host.error ?? inkProblem} />

      <div className="grid gap-3">
        {showing && (
          <div className="flex justify-center rounded-2xl bg-[hsl(222_30%_10%)] px-3 py-1.5">
            <InkToolbar tools={tools} onTools={setTools} onWipe={() => board?.clear()} />
          </div>
        )}
        {/* As wide as fits, but short enough that the page buttons stay on screen. */}
        <div className="relative mx-auto aspect-video w-full max-w-[calc(70vh*16/9)] rounded-2xl bg-white ring-1 ring-border">
          <InkLayer board={board} aspect={WHITEBOARD_ASPECT} tools={showing ? tools : { ...tools, tool: null }} />
        </div>
        {showing && (
          <div className="flex flex-wrap items-center justify-center gap-4">
            <Button variant="quiet" className="min-h-14 px-6 text-base" disabled={here.page <= 1} onClick={() => go(-1)}><ChevronLeft className="size-5" /> Previous</Button>
            <span className="min-w-36 text-center text-lg font-semibold tabular-nums" role="status">Page {here.page} of {here.pages}</span>
            <Button variant="quiet" className="min-h-14 px-6 text-base" disabled={here.page >= here.pages} onClick={() => go(1)}>Next <ChevronRight className="size-5" /></Button>
            <Button variant="quiet" className="min-h-14 px-6 text-base" disabled={here.pages >= WHITEBOARD_PAGES_MAX} onClick={addPage}><Plus className="size-5" /> Add page</Button>
          </div>
        )}
      </div>
    </div>
  );
}
