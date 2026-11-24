import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { MonitorPlay, Pause, Pencil, Volume2, VolumeX } from 'lucide-react';
import { Show, showPosition, showRoom, WHITEBOARD_ASPECT, type ContentItem, type ScreenEvent } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { useLatest } from '../../ui/ui';
import { useT } from '../../i18n/i18n';
import { useFileUrl } from '../content/useFileUrl';
import { InkLayer, InkToolbar, useInk, useInkProblem, type InkTools } from './Ink';
import type { InkBoard } from './ink-board';
import { PenAsk } from './PenAsk';
import { pageWords } from './show-pages';

// pdf.js is big, so it is fetched only when the teacher first shows a book.
const PdfPages = lazy(() => import('../content/PdfPages').then((m) => ({ default: m.PdfPages })));

// A show as this screen received it: what the server said, and when (on this PC's own stopwatch).
export interface LiveShow { show: Show; gotAt: number }

// How far the video may be from the teacher's before it is pulled back into place. A little slack
// while playing, because pulling it back makes the picture jump; none to speak of while paused.
const SLACK_PLAYING_S = 1;
const SLACK_PAUSED_S = 0.3;
const CHECK_EVERY_MS = 2000;
const ASK_EVERY_MS = 5000;
// The video should be moving but is not: after this long the screen says it is waiting, and after
// the second it starts the video afresh (again and again, until the Server PC is back).
const WAITING_AFTER_MS = 4000;
const RETRY_AFTER_MS = 12_000;

// What the teacher is showing this student's class right now, if anything. The live channel tells
// the screen the moment something changes; asking every few seconds as well keeps it right even if
// the live channel is down for a while.
export function useClassShow(): LiveShow | null {
  const { relay, call, state } = useApp();
  const p = state.session?.principal;
  const classId = p?.kind === 'student' ? p.classId : null;
  const [live, setLive] = useState<LiveShow | null>(null);
  useEffect(() => {
    if (!classId) return;
    let alive = true;
    const take = (s: unknown) => {
      const parsed = Show.nullable().safeParse(s);
      if (alive && parsed.success) setLive(parsed.data ? { show: parsed.data, gotAt: performance.now() } : null);
    };
    const leave = relay.subscribe(showRoom(classId), take);
    const ask = () => void call('GET /api/v1/shows/mine').then(take, () => undefined);
    ask();
    const t = setInterval(ask, ASK_EVERY_MS);
    return () => { alive = false; leave(); clearInterval(t); setLive(null); };
  }, [relay, call, classId]);
  return live;
}

// The teacher's video, over whatever the student was doing. It follows the teacher: there is nothing
// to press here except the sound. What the teacher writes on the video shows here too, and a student
// she gives the pen to can write on it for the whole class to see. The screen underneath is kept as it was, so a half-written answer
// is still there when the teacher stops showing.
export function ClassShow({ live }: { live: LiveShow }) {
  const { show } = live;
  if (show.kind === 'video') return show.item ? <ClassVideo live={live} item={show.item} /> : null;
  if (show.kind !== 'whiteboard' && !show.item) return null;
  // A new show starts afresh: nothing left over from the last one (a book that would not open, say).
  return <ClassPages key={show.id} live={live} />;
}

// A PDF, a picture or a blank whiteboard, on the page the teacher is on, with the writing of that
// page only. The student with the pen may write on it at any time.
function ClassPages({ live }: { live: LiveShow }) {
  const { show } = live;
  const { call, state } = useApp();
  const t = useT();
  const me = state.session?.principal;
  const myId = me?.kind === 'student' ? me.studentId : '';
  const board = useInk(show, myId, me?.kind === 'student' ? me.name : '');
  const inkProblem = useInkProblem(board);
  const hasPen = !!myId && show.pen?.studentId === myId;
  const [picked, setPicked] = useState<InkTools>({ tool: 'pen', colour: 'blue', width: 'medium' });
  const tools: InkTools = hasPen ? picked : { ...picked, tool: null };
  const [failed, setFailed] = useState(false);
  const title = show.item?.title ?? t('Whiteboard');

  // Tells the server how the show is going on this PC, for its diary, as for a video. Each is said
  // once for this show (also when React runs an effect twice, as it does in development).
  const said = useRef(new Set<ScreenEvent>());
  const showId = show.id;
  const say = useLatest((event: ScreenEvent) => {
    if (said.current.has(event)) return;
    said.current.add(event);
    void call('POST /api/v1/shows/:id/screen', { params: { id: showId }, body: { event, position: 0, behind: 0 } }).catch(() => undefined);
  });
  useEffect(() => { say.current('opened'); }, [say]);
  const ready = () => say.current('ready');
  const fail = () => { setFailed(true); say.current('failed'); };

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-black text-white" role="dialog" aria-modal="true" aria-label={t('Your teacher is showing: {title}', { title })}>
      <div className="flex flex-wrap items-center gap-3 px-5 py-3">
        <MonitorPlay className="size-5 shrink-0 text-white/70" />
        <p className="min-w-48 flex-1 text-lg font-semibold">{title}</p>
        {show.kind !== 'image' && <p className="text-lg font-semibold tabular-nums" role="status">{pageWords(show.page, show.pages, t)}</p>}
        <p className="text-sm text-white/70">{t('{teacher} is showing this to Class {name}', { teacher: show.byName, name: show.className })}</p>
        {!failed && hasPen && (
          <div className="flex flex-wrap items-center gap-2 rounded-full bg-primary px-4 py-1 text-sm font-semibold text-primary-foreground" role="status">
            <Pencil className="size-4" />
            <span>{t('You have the pen. Write on the page.')}</span>
            <InkToolbar tools={tools} onTools={setPicked} />
          </div>
        )}
        {!failed && myId && !hasPen && <PenAsk show={show} />}
        {!failed && inkProblem && <p className="rounded-full bg-white/15 px-4 py-2 text-sm font-medium" role="alert">{t(inkProblem)}</p>}
      </div>
      <div className="relative min-h-0 flex-1">
        {show.kind === 'whiteboard' ? (
          <ShownBoard board={board} tools={tools} own={myId} onReady={ready} />
        ) : show.item && (
          <ShownFile item={show.item} page={show.page} board={board} tools={tools} own={myId} failed={failed} onReady={ready} onFail={fail} />
        )}
      </div>
    </div>
  );
}

interface PageProps { board: InkBoard | null; tools: InkTools; own: string; onReady: () => void }

// A blank 16:9 board, as big as fits, with plain bars where the screen has another shape: a line
// lands in the same place on every screen.
function ShownBoard({ board, tools, own, onReady }: PageProps) {
  const told = useLatest(onReady);
  useEffect(() => { told.current(); }, [told]);
  return (
    <div className="absolute inset-0 grid place-items-center p-3 [container-type:size]">
      <div className="relative aspect-video w-[min(100cqw,calc(100cqh*16/9))] rounded-lg bg-white">
        <InkLayer board={board} aspect={WHITEBOARD_ASPECT} tools={tools} own={own} />
      </div>
    </div>
  );
}

// A book on the teacher's page, or a picture, shown whole, with the writing laid over it.
function ShownFile({ item, page, board, tools, own, failed, onReady, onFail }: PageProps & {
  item: ContentItem; page: number; failed: boolean; onFail: () => void;
}) {
  // A streamed file that cannot be read is fetched whole instead; past that, the screen says so.
  const t = useT();
  const { url, percent, error, onError } = useFileUrl(item, { streamPdf: true });
  const [aspect, setAspect] = useState<number | null>(null);
  const told = useLatest(onFail);
  useEffect(() => { if (error) told.current(); }, [told, error]);
  const broken = onError ?? onFail;
  const layer = <InkLayer board={board} aspect={aspect} tools={tools} own={own} />;

  if (failed || error) {
    const what = item.kind === 'pdf' ? t('This book cannot be opened on this PC. Tell your teacher.') : t('This picture cannot be shown on this PC. Tell your teacher.');
    return <p className="absolute inset-0 grid place-items-center p-8 text-center text-lg text-white/80">{what}</p>;
  }
  if (!url) return <p className="absolute inset-0 grid place-items-center text-lg text-white/80" role="status">{t('Opening… {percent}%', { percent })}</p>;
  if (item.kind === 'image') {
    return (
      <>
        <img
          src={url} alt={item.title} onError={broken} className="absolute inset-0 size-full object-contain" onContextMenu={(e) => e.preventDefault()}
          onLoad={(e) => { const { naturalWidth: w, naturalHeight: h } = e.currentTarget; if (w && h) setAspect(w / h); onReady(); }}
        />
        {layer}
      </>
    );
  }
  return (
    <div className="absolute inset-0 text-white/80">
      <Suspense fallback={<p className="grid h-full place-items-center" role="status">{t('Opening…')}</p>}>
        <PdfPages
          url={url} page={page} onPages={() => undefined} onError={broken} layer={layer}
          onAspect={(a) => { setAspect(a); onReady(); }}
        />
      </Suspense>
    </div>
  );
}

function ClassVideo({ live, item }: { live: LiveShow; item: NonNullable<LiveShow['show']['item']> }) {
  const { show } = live;
  const { call, state } = useApp();
  const t = useT();
  const me = state.session?.principal;
  const myId = me?.kind === 'student' ? me.studentId : '';
  const board = useInk(show, myId, me?.kind === 'student' ? me.name : '');
  const inkProblem = useInkProblem(board);
  const [aspect, setAspect] = useState<number | null>(null);
  const hasPen = !!myId && show.pen?.studentId === myId;
  // With the pen, the pen is in hand at once; it works while the teacher has the video paused.
  const [picked, setPicked] = useState<InkTools>({ tool: 'pen', colour: 'blue', width: 'medium' });
  const tools: InkTools = hasPen && !show.playing ? picked : { ...picked, tool: null };
  const { url, percent, error, onError } = useFileUrl(item);
  const video = useRef<HTMLVideoElement>(null);
  const latest = useLatest(live);
  const [muted, setMuted] = useState(false);
  const [failed, setFailed] = useState(false);
  // The video is not arriving (the Server PC is off, or the cable is out). Changing `attempt` starts
  // the video afresh; following the teacher then puts it at the right place again by itself.
  const [waiting, setWaiting] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const known = useRef(false);
  const waitingNow = useRef(false);
  const saidSilent = useRef(false);

  // Tells the server how the video is going on this PC, for its diary. Never shown to the student,
  // and a report that does not get through is simply lost: the lesson matters more than the diary.
  const say = (event: ScreenEvent) => {
    // Playing without sound is said once, not each time the screen tries again.
    if (event === 'silent') { if (saidSilent.current) return; saidSilent.current = true; }
    const v = video.current;
    const { show: s, gotAt } = latest.current;
    const position = v ? v.currentTime : 0;
    const behind = v && v.readyState >= 1 ? showPosition(s, performance.now() - gotAt) - position : 0;
    void call('POST /api/v1/shows/:id/screen', { params: { id: s.id }, body: { event, position: Math.max(0, position), behind } }).catch(() => undefined);
  };
  // "Waiting for the Server PC" on and off; said to the server only when it changes.
  const wait = (on: boolean) => {
    setWaiting(on);
    if (waitingNow.current === on) return;
    waitingNow.current = on;
    say(on ? 'waiting' : 'recovered');
  };
  // Timers and the video's own events call these long after this render; they get the newest ones.
  const tell = useLatest({ say, wait });
  const showId = show.id;
  // Said once for each show, also when React runs this effect twice (as it does in development).
  const openedShow = useRef('');
  useEffect(() => {
    if (openedShow.current === showId) return;
    openedShow.current = showId;
    tell.current.say('opened');
  }, [tell, showId]);
  useEffect(() => { if (error) tell.current.say('failed'); }, [tell, error]);
  const moved = useRef({ at: 0, when: 0 });

  // Puts this screen's video where the teacher's is.
  const follow = () => {
    const v = video.current;
    if (!v || v.readyState < 1) return;
    const { show: s, gotAt } = latest.current;
    const end = Number.isFinite(v.duration) ? v.duration : Infinity;
    const want = Math.min(showPosition(s, performance.now() - gotAt), end);
    if (Math.abs(v.currentTime - want) > (s.playing ? SLACK_PLAYING_S : SLACK_PAUSED_S)) v.currentTime = want;
    if (v.playbackRate !== s.rate) v.playbackRate = s.rate;
    if (s.playing && want < end - 0.2) {
      // A web view may refuse to start sound by itself. The picture matters more: play silent, and
      // show a button to turn the sound on.
      if (v.paused) void v.play().catch(() => { v.muted = true; setMuted(true); say('silent'); return v.play().catch(() => undefined); });
    } else if (!v.paused) v.pause();
  };
  const followNow = useLatest(follow);
  useEffect(() => { followNow.current(); }, [followNow, live, url]);
  useEffect(() => { const t = setInterval(() => followNow.current(), CHECK_EVERY_MS); return () => clearInterval(t); }, [followNow]);
  // Is the video moving when the teacher's is? If not for a while, say so and start it afresh.
  useEffect(() => {
    moved.current.when = performance.now();
    const t = setInterval(() => {
      const v = video.current;
      const now = performance.now();
      const meant = latest.current.show.playing && !!v && !v.ended;
      // "Moving" needs a picture to show: a video started afresh that has loaded nothing yet is not moving.
      if (v && !v.error && (!meant || (v.readyState >= 2 && v.currentTime !== moved.current.at))) { moved.current = { at: v.currentTime, when: now }; tell.current.wait(false); return; }
      if (!v) return;
      if (now - moved.current.when > WAITING_AFTER_MS) tell.current.wait(true);
      if (now - moved.current.when > RETRY_AFTER_MS) { moved.current.when = now - WAITING_AFTER_MS; setAttempt((n) => n + 1); tell.current.say('retrying'); }
    }, 500);
    return () => clearInterval(t);
  }, [latest, tell]);

  const sound = () => { const v = video.current; if (!v) return; v.muted = !v.muted; setMuted(v.muted); };

  return (
    <div className="fixed inset-0 z-40 flex flex-col bg-black text-white" role="dialog" aria-modal="true" aria-label={t('Your teacher is showing: {title}', { title: item.title })}>
      <div className="flex flex-wrap items-center gap-3 px-5 py-3">
        <MonitorPlay className="size-5 shrink-0 text-white/70" />
        <p className="min-w-48 flex-1 text-lg font-semibold">{item.title}</p>
        <p className="text-sm text-white/70">{t('{teacher} is showing this to Class {name}', { teacher: show.byName, name: show.className })}</p>
        {/* These sit up here, never on the picture: a lesson often has writing right at its bottom edge. */}
        {url && !failed && waiting && (
          <p className="flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-sm font-medium" role="alert">{t('Waiting for the Server PC…')}</p>
        )}
        {url && !failed && hasPen && (
          <div className="flex flex-wrap items-center gap-2 rounded-full bg-primary px-4 py-1 text-sm font-semibold text-primary-foreground" role="status">
            <Pencil className="size-4" />
            <span>{show.playing ? t('You have the pen. You can write when your teacher pauses the video.') : t('You have the pen. Write on the video.')}</span>
            {!show.playing && <InkToolbar tools={tools} onTools={setPicked} />}
          </div>
        )}
        {url && !failed && myId && !hasPen && <PenAsk show={show} />}
        {url && !failed && inkProblem && <p className="rounded-full bg-white/15 px-4 py-2 text-sm font-medium" role="alert">{t(inkProblem)}</p>}
        {url && !failed && !show.playing && (
          <p className="flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-sm font-medium" role="status"><Pause className="size-4 fill-current" strokeWidth={0} /> {t('Paused by your teacher')}</p>
        )}
        {url && !failed && muted && show.playing && (
          <button type="button" onClick={sound} className="flex cursor-pointer items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground focus-visible:outline-white"><Volume2 className="size-4" /> {t('Turn sound on')}</button>
        )}
        {url && !failed && (
          <button type="button" onClick={sound} aria-label={muted ? t('Turn sound on') : t('Turn sound off')} className="grid size-11 cursor-pointer place-items-center rounded-full hover:bg-white/15 focus-visible:outline-white">
            {muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
          </button>
        )}
      </div>
      <div className="relative min-h-0 flex-1">
        {failed || error ? (
          <p className="absolute inset-0 grid place-items-center p-8 text-center text-lg text-white/80">{t('This video cannot be played on this PC. Tell your teacher.')}</p>
        ) : !url ? (
          <p className="absolute inset-0 grid place-items-center text-lg text-white/80" role="status">{t('Opening… {percent}%', { percent })}</p>
        ) : (
          <video
            key={`${url} ${attempt}`} ref={video} src={url} playsInline preload="auto" disablePictureInPicture
            className="absolute inset-0 size-full object-contain" onContextMenu={(e) => e.preventDefault()}
            onLoadedMetadata={(e) => { known.current = true; if (e.currentTarget.videoWidth && e.currentTarget.videoHeight) setAspect(e.currentTarget.videoWidth / e.currentTarget.videoHeight); follow(); say('ready'); }} onCanPlay={follow}
            // Never worked: try the other way of fetching it, or say so. Worked and then broke: the watchdog starts it afresh.
            onError={() => { if (known.current) return wait(true); if (onError) onError(); else { setFailed(true); say('failed'); } }}
          />
        )}
        {url && !failed && !error && <InkLayer board={board} aspect={aspect} tools={tools} own={myId} />}
      </div>
    </div>
  );
}
