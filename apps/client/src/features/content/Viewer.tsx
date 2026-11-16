import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, MonitorPlay } from 'lucide-react';
import { SHOW_BEAT_MS, type ContentItem, type Show } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { ApiCallError } from '../../core/api-client';
import { Button, Card, ErrorNote, Note, Select, useAction, useLatest } from '../../ui/ui';
import { InkLayer, InkToolbar, useInk, useInkProblem, type InkTools } from '../shows/Ink';
import { KIND_WORDS, sizeWords } from './files';
import { useFileUrl } from './useFileUrl';
import { VideoPlayer, type PlayerState } from './VideoPlayer';

// Opens one library item: a picture as a picture, a PDF in the built-in reader, video and sound with
// their own players. A teacher who may host lessons can also show a video to its class: it then plays
// on the class's screens too, following whatever she does here.
export function Viewer({ item, onBack }: { item: ContentItem; onBack: () => void }) {
  const { call, state } = useApp();
  const { url, percent, error, onError } = useFileUrl(item);

  // --- Show to class ---
  const me = state.session?.principal;
  const canShow = item.kind === 'video' && me?.kind === 'staff' && me.permissions.includes('lesson.present');
  const [showing, setShowing] = useState(false);
  const showId = useRef<string | null>(null);
  // The show as the server last described it: who is watching, who has the pen, how much is written.
  const [live, setLive] = useState<Show | null>(null);
  // Asks the player where it is right now.
  const peek = useRef<(() => PlayerState) | null>(null);
  const tell = (s: PlayerState) => {
    const id = showId.current;
    if (!id) return;
    call('PUT /api/v1/shows/:id', { params: { id }, body: s }).then((now) => { if (showId.current === id) setLive(now); }, (e) => {
      if (!(e instanceof ApiCallError) || showId.current !== id) return;
      // Someone else is now showing this class something: stop saying this show is on.
      if (e.status === 410) { showId.current = null; setShowing(false); setLive(null); }
      // The server no longer knows the show (the Server PC was away for a while, or restarted) but the
      // teacher never stopped it: start it again, at the place her video is now.
      if (e.status === 404) {
        showId.current = null;
        call('POST /api/v1/shows', { body: { contentId: item.id } }).then(
          (again) => { showId.current = again.id; setLive(again); const now = peek.current?.(); if (now) tell(now); },
          () => { setShowing(false); setLive(null); },
        );
      }
    });
  };
  const tellNow = useLatest(tell);
  const startShow = useAction(async () => {
    const s = await call('POST /api/v1/shows', { body: { contentId: item.id } });
    showId.current = s.id;
    setLive(s);
    setShowing(true);
    const now = peek.current?.();
    if (now) tell(now);
  });
  const stopShow = useAction(async () => {
    const id = showId.current;
    showId.current = null;
    setShowing(false);
    setLive(null);
    if (id) await call('DELETE /api/v1/shows/:id', { params: { id } });
  });
  // While showing, the server hears from this screen every few seconds, so it knows the teacher is
  // still here; and the class's screens are put right if one has drifted.
  useEffect(() => {
    if (!showing) return;
    const t = setInterval(() => { const s = peek.current?.(); if (s) tellNow.current(s); }, SHOW_BEAT_MS);
    return () => clearInterval(t);
  }, [showing, tellNow]);
  // Leaving the video ends the show.
  useEffect(() => () => { const id = showId.current; if (id) void call('DELETE /api/v1/shows/:id', { params: { id } }).catch(() => undefined); }, [call]);

  // --- Writing on the video, while it is being shown ---
  const board = useInk(showing ? live : null, 'teacher', me?.kind === 'staff' ? me.displayName : '');
  const inkProblem = useInkProblem(board);
  const [picked, setPicked] = useState<InkTools>({ tool: null, colour: 'red', width: 'medium' });
  const [aspect, setAspect] = useState<number | null>(null);
  const pause = useRef<(() => void) | null>(null);
  const tools: InkTools = showing ? picked : { ...picked, tool: null };
  const givePen = useAction(async (studentId: string | null) => {
    const id = showId.current;
    if (id) setLive(await call('PUT /api/v1/shows/:id/pen', { params: { id }, body: { studentId } }));
  });
  const watching = live?.watching ?? [];

  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="quiet" onClick={onBack}><ArrowLeft className="size-4" /> Back</Button>
        <h1 className="min-w-48 flex-1 font-display text-2xl font-semibold">{item.title}</h1>
        <span className="text-sm text-muted-foreground">{[KIND_WORDS[item.kind], item.subject, item.chapter, item.size ? sizeWords(item.size) : null].filter(Boolean).join(' · ')}</span>
      </div>
      <ErrorNote message={error} />
      {canShow && url && (
        showing ? (
          <div className="flex flex-wrap items-center gap-3 rounded-xl border border-primary/40 bg-primary/10 px-4 py-3" role="status">
            <MonitorPlay className="size-5 shrink-0 text-primary" />
            <p className="min-w-56 flex-1"><b>Class {item.className} can see this now.</b> When you play, pause or skip, their screens do the same. What you write with the pen, they see too.</p>
            {live?.pen ? (
              <>
                <span><b>{live.pen.name}</b> has the pen.</span>
                <Button variant="quiet" disabled={givePen.busy} onClick={() => givePen.run(null)}>Take the pen back</Button>
              </>
            ) : (
              <Select aria-label="Give the pen to a student" className="w-auto" value="" disabled={givePen.busy || watching.length === 0} onChange={(e) => { if (e.target.value) void givePen.run(e.target.value); }}>
                <option value="">{watching.length ? 'Give the pen to…' : 'No student screen has it open yet'}</option>
                {watching.map((w) => <option key={w.studentId} value={w.studentId}>{w.name}</option>)}
              </Select>
            )}
            <Button variant="quiet" disabled={stopShow.busy} onClick={() => stopShow.run()}>Stop showing</Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={startShow.busy} onClick={() => startShow.run()}><MonitorPlay className="size-4" /> Show to Class {item.className}</Button>
            <span className="text-sm text-muted-foreground">The video opens on every student PC of the class and follows what you do here.</span>
          </div>
        )
      )}
      <ErrorNote message={startShow.error ?? stopShow.error ?? givePen.error ?? inkProblem} />

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
          {item.kind === 'image' && <img src={url} alt={item.title} onError={onError} className="mx-auto max-h-[75vh] max-w-full rounded-xl border border-border bg-card" />}
          {item.kind === 'pdf' && <iframe src={url} title={item.title} className="h-[78vh] w-full rounded-xl border border-border bg-card" />}
          {item.kind === 'video' && (
            <VideoPlayer
              key={url} src={url} title={item.title} onError={onError} peek={peek} onState={showing ? tell : undefined}
              // The pen touching down pauses the video: writing is about one moment of it.
              pause={pause} onAspect={setAspect} layer={<InkLayer board={board} aspect={aspect} tools={tools} onPenDown={() => pause.current?.()} />}
              tools={showing && <InkToolbar tools={tools} onTools={setPicked} onWipe={() => board?.clear()} />}
              plain={tools.tool !== null}
            />
          )}
          {item.kind === 'audio' && <Card className="p-8"><audio src={url} controls onError={onError} className="w-full" /></Card>}
        </>
      )}
    </div>
  );
}
