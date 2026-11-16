import { useEffect, useRef, useState } from 'react';
import { MonitorPlay, Pause, Pencil, Volume2, VolumeX } from 'lucide-react';
import { Show, showPosition, showRoom, type ScreenEvent } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { useLatest } from '../../ui/ui';
import { useFileUrl } from '../content/useFileUrl';
import { InkLayer, InkToolbar, useInk, useInkProblem, type InkTools } from './Ink';

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
  const { call, state } = useApp();
  const me = state.session?.principal;
  const myId = me?.kind === 'student' ? me.studentId : '';
  const board = useInk(show, myId, me?.kind === 'student' ? me.name : '');
  const inkProblem = useInkProblem(board);
  const [aspect, setAspect] = useState<number | null>(null);
  const hasPen = !!myId && show.pen?.studentId === myId;
  // With the pen, the pen is in hand at once; it works while the teacher has the video paused.
  const [picked, setPicked] = useState<InkTools>({ tool: 'pen', colour: 'blue', width: 'medium' });
  const tools: InkTools = hasPen && !show.playing ? picked : { ...picked, tool: null };
  const { url, percent, error, onError } = useFileUrl(show.item);
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
    <div className="fixed inset-0 z-40 flex flex-col bg-black text-white" role="dialog" aria-modal="true" aria-label={`Your teacher is showing: ${show.item.title}`}>
      <div className="flex flex-wrap items-center gap-3 px-5 py-3">
        <MonitorPlay className="size-5 shrink-0 text-white/70" />
        <p className="min-w-48 flex-1 text-lg font-semibold">{show.item.title}</p>
        <p className="text-sm text-white/70">{show.byName} is showing this to Class {show.className}</p>
        {/* These sit up here, never on the picture: a lesson often has writing right at its bottom edge. */}
        {url && !failed && waiting && (
          <p className="flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-sm font-medium" role="alert">Waiting for the Server PC…</p>
        )}
        {url && !failed && hasPen && (
          <div className="flex flex-wrap items-center gap-2 rounded-full bg-primary px-4 py-1 text-sm font-semibold text-primary-foreground" role="status">
            <Pencil className="size-4" />
            <span>{show.playing ? 'You have the pen. You can write when your teacher pauses the video.' : 'You have the pen. Write on the video.'}</span>
            {!show.playing && <InkToolbar tools={tools} onTools={setPicked} />}
          </div>
        )}
        {url && !failed && inkProblem && <p className="rounded-full bg-white/15 px-4 py-2 text-sm font-medium" role="alert">{inkProblem}</p>}
        {url && !failed && !show.playing && (
          <p className="flex items-center gap-2 rounded-full bg-white/15 px-4 py-2 text-sm font-medium" role="status"><Pause className="size-4 fill-current" strokeWidth={0} /> Paused by your teacher</p>
        )}
        {url && !failed && muted && show.playing && (
          <button type="button" onClick={sound} className="flex cursor-pointer items-center gap-2 rounded-full bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground focus-visible:outline-white"><Volume2 className="size-4" /> Turn sound on</button>
        )}
        {url && !failed && (
          <button type="button" onClick={sound} aria-label={muted ? 'Turn sound on' : 'Turn sound off'} className="grid size-11 cursor-pointer place-items-center rounded-full hover:bg-white/15 focus-visible:outline-white">
            {muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}
          </button>
        )}
      </div>
      <div className="relative min-h-0 flex-1">
        {failed || error ? (
          <p className="absolute inset-0 grid place-items-center p-8 text-center text-lg text-white/80">This video cannot be played on this PC. Tell your teacher.</p>
        ) : !url ? (
          <p className="absolute inset-0 grid place-items-center text-lg text-white/80" role="status">Opening… {percent}%</p>
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
