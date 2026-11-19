import { lazy, Suspense, useRef, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, MonitorPlay } from 'lucide-react';
import { canShow as showable, type ContentItem, type ShowableKind } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, Card, ErrorNote, Note } from '../../ui/ui';
import { InkLayer, InkToolbar, useInk, useInkProblem, type InkTools } from '../shows/Ink';
import { PenAsks, PenRow } from '../shows/PenRow';
import { turnPage } from '../shows/show-pages';
import { useShowHost } from '../shows/useShowHost';
import { KIND_WORDS, sizeWords } from './files';
import { useFileUrl } from './useFileUrl';
import { VideoPlayer, type PlayerState } from './VideoPlayer';

// pdf.js is big, so it is fetched only when a PDF is first opened this way.
const PdfPages = lazy(() => import('./PdfPages').then((m) => ({ default: m.PdfPages })));

// What the teacher is told about a show, before and while it is on.
const SHOW_WORDS: Record<ShowableKind, { before: string; during: string }> = {
  video: { before: 'The video opens on every student PC of the class and follows what you do here.', during: 'When you play, pause or skip, their screens do the same.' },
  pdf: { before: 'The book opens on every student PC of the class, on the page you are on.', during: 'When you turn the page, their screens turn too.' },
  image: { before: 'The picture opens on every student PC of the class.', during: '' },
};

// Opens one library item: a picture as a picture, a PDF page by page (students: in the built-in
// reader), video and sound with their own players. A teacher who may host lessons can also show a
// video, a PDF or a picture to its class: it then opens on the class's screens too, following
// whatever she does here, and what she writes on it with the pen shows there as well.
export function Viewer({ item, onBack }: { item: ContentItem; onBack: () => void }) {
  const { state } = useApp();
  const me = state.session?.principal;
  const staff = me?.kind === 'staff';
  const { url, percent, error, onError } = useFileUrl(item, { streamPdf: staff });

  // --- Show to class ---
  const canShow = staff && me.permissions.includes('lesson.present') && showable(item.kind);
  const words = showable(item.kind) ? SHOW_WORDS[item.kind] : null;
  // Asks the player where it is right now.
  const peek = useRef<(() => PlayerState) | null>(null);
  const host = useShowHost({ contentId: item.id }, peek);
  const { showing, live } = host;

  // --- Turning the pages of a PDF ---
  const [page, setPage] = useState(1);
  const [pages, setPages] = useState<number | null>(null);
  const [bookError, setBookError] = useState<string | null>(null);
  const go = (by: number) => {
    const next = turnPage(page, by, pages);
    if (next === page) return;
    setPage(next);
    host.turn(next);
  };
  const counted = (n: number) => {
    const at = Math.min(page, n);
    setPages(n);
    setPage(at);
    host.turn(at, n);
  };

  // --- Writing on what is shown, while it is being shown ---
  // On the teacher's screen the writing goes on the page she is on (a picture has one page).
  const inkPage = item.kind === 'pdf' ? page : item.kind === 'image' ? 1 : undefined;
  const board = useInk(showing ? live : null, 'teacher', staff ? me.displayName : '', inkPage);
  const inkProblem = useInkProblem(board);
  const [picked, setPicked] = useState<InkTools>({ tool: null, colour: 'red', width: 'medium' });
  const [aspect, setAspect] = useState<number | null>(null);
  const pause = useRef<(() => void) | null>(null);
  const tools: InkTools = showing ? picked : { ...picked, tool: null };
  const toolbar = showing && <InkToolbar tools={tools} onTools={setPicked} onWipe={() => board?.clear()} />;
  // The teacher's PDF and picture get the whole window: one slim row of buttons on top, and under it
  // the page as tall as the window allows, with the pen down its left side and the page buttons down
  // its right. A page is tall and a board is wide, so the sides are where there is room to spare.
  const fill = staff && (item.kind === 'pdf' || item.kind === 'image');
  const penRail = showing && (
    <div className="flex shrink-0 flex-col items-center justify-center rounded-2xl bg-[hsl(222_30%_10%)] px-1.5 py-3">
      <InkToolbar vertical tools={tools} onTools={setPicked} onWipe={() => board?.clear()} />
    </div>
  );
  // Who has the pen, and the way to give it or take it back.
  const penGiving = <PenRow host={host} />;

  return (
    <div className={fill ? 'flex h-full w-full flex-col gap-3' : 'mx-auto grid w-full max-w-5xl gap-4'}>
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="quiet" onClick={onBack}><ArrowLeft className="size-4" /> Back</Button>
        <h1 className="min-w-48 flex-1 truncate font-display text-2xl font-semibold">{item.title}</h1>
        {fill && canShow && url ? (
          showing ? (
            <div className="flex flex-wrap items-center gap-3" role="status">
              <span className="flex h-11 items-center gap-2 rounded-full bg-primary/10 px-5 text-base font-semibold text-primary"><MonitorPlay className="size-5 shrink-0" /> Class {item.className} can see this now</span>
              {penGiving}
              <Button variant="quiet" disabled={host.busy.stop} onClick={() => host.stop()}>Stop showing</Button>
            </div>
          ) : (
            <Button disabled={host.busy.start} onClick={() => host.start()} title={words?.before}><MonitorPlay className="size-4" /> Show to Class {item.className}</Button>
          )
        ) : (
          <span className="text-sm text-muted-foreground">{[KIND_WORDS[item.kind], item.subject, item.chapter, item.size ? sizeWords(item.size) : null].filter(Boolean).join(' · ')}</span>
        )}
      </div>
      <ErrorNote message={error} />
      {!fill && canShow && url && (
        showing ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/40 bg-primary/10 px-4 py-3" role="status">
            <MonitorPlay className="size-5 shrink-0 text-primary" />
            <p className="min-w-56 flex-1"><b>Class {item.className} can see this now.</b> {words?.during} What you write with the pen, they see too.</p>
            {penGiving}
            <Button variant="quiet" disabled={host.busy.stop} onClick={() => host.stop()}>Stop showing</Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={host.busy.start} onClick={() => host.start()}><MonitorPlay className="size-4" /> Show to Class {item.className}</Button>
            <span className="text-sm text-muted-foreground">{words?.before}</span>
          </div>
        )
      )}
      {showing && <PenAsks host={host} />}
      <ErrorNote message={host.error ?? inkProblem} />
      <ErrorNote message={bookError} />

      {item.kind === 'link' ? (
        <Card className="grid gap-3 p-6">
          <Note>This is a web page. It opens only when the lab has internet.</Note>
          <p className="text-lg break-all select-all">{item.url}</p>
        </Card>
      ) : !url && !error ? (
        <Card className="grid gap-3 p-8 text-center">
          <p className="text-muted-foreground">Opening… {percent}%</p>
          <div className="mx-auto h-2 w-64 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Opening the file">
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
          </div>
        </Card>
      ) : url && (
        <>
          {item.kind === 'image' && (staff ? (
            <div className="flex min-h-0 flex-1 gap-3">
              {penRail}
              {/* The picture is drawn whole, as big as the box allows. The writing layer covers the same
                  box and finds the picture in it from its shape, as on a video. */}
              <div className="relative min-h-64 min-w-0 flex-1 overflow-hidden rounded-2xl border border-border bg-card">
                <img
                  src={url} alt={item.title} onError={onError}
                  onLoad={(e) => { const { naturalWidth: w, naturalHeight: h } = e.currentTarget; if (w && h) setAspect(w / h); }}
                  className="absolute inset-0 size-full object-contain"
                />
                <InkLayer board={board} aspect={aspect} tools={tools} />
              </div>
            </div>
          ) : <img src={url} alt={item.title} onError={onError} className="mx-auto block max-h-[75vh] max-w-full rounded-2xl bg-card ring-1 ring-border" />)}
          {item.kind === 'pdf' && (staff ? (
            <div className="flex min-h-0 flex-1 gap-3">
              {penRail}
              <div className="min-h-64 min-w-0 flex-1 overflow-hidden rounded-2xl border border-border bg-card">
                <Suspense fallback={<p className="grid h-full place-items-center text-muted-foreground" role="status">Opening…</p>}>
                  <PdfPages
                    url={url} page={page} onPages={counted} onAspect={setAspect}
                    // A streamed book that cannot be read is fetched whole instead; past that, say so.
                    onError={onError ?? (() => setBookError('This book could not be opened.'))}
                    layer={<InkLayer board={board} aspect={aspect} tools={tools} />}
                  />
                </Suspense>
              </div>
              <div className="flex w-36 shrink-0 flex-col items-stretch justify-center gap-3">
                <Button variant="quiet" className="min-h-20 flex-col text-base" disabled={page <= 1} onClick={() => go(-1)}><ChevronLeft className="size-6" /> Previous</Button>
                <span className="text-center text-lg font-semibold tabular-nums" role="status">Page {page} of {pages ?? '…'}</span>
                <Button className="min-h-20 flex-col text-base" disabled={pages === null || page >= pages} onClick={() => go(1)}><ChevronRight className="size-6" /> Next</Button>
              </div>
            </div>
          ) : <iframe src={url} title={item.title} className="h-[78vh] w-full rounded-2xl border border-border bg-card" />)}
          {item.kind === 'video' && (
            <VideoPlayer
              key={url} src={url} title={item.title} onError={onError} peek={peek} onState={showing ? host.tell : undefined}
              // The pen touching down pauses the video: writing is about one moment of it.
              pause={pause} onAspect={setAspect} layer={<InkLayer board={board} aspect={aspect} tools={tools} onPenDown={() => pause.current?.()} />}
              tools={toolbar}
              plain={tools.tool !== null}
            />
          )}
          {item.kind === 'audio' && <Card className="p-8"><audio src={url} controls onError={onError} className="w-full" /></Card>}
        </>
      )}
    </div>
  );
}
