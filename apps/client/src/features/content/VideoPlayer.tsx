import { useCallback, useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent, type MutableRefObject, type ReactNode } from 'react';
import { Maximize, Minimize, Pause, Play, RotateCcw, RotateCw, Volume2, VolumeX } from 'lucide-react';
import { Button, cn } from '../../ui/ui';
import { useT } from '../../i18n/i18n';
import { clock } from './files';
import { SchoolMark } from './SchoolMark';

const SPEEDS = [1, 1.25, 1.5, 0.75];
const JUMP = 10;
// With the video playing and the mouse still, the buttons fade away after this long.
const HIDE_AFTER_MS = 2500;
// A video that should be moving but has not moved for this long shows the loading ring...
const SLOW_AFTER_MS = 1500;
// ...and for this long, a plain message: the Server PC is probably off or the cable is out.
const STUCK_AFTER_MS = 10_000;
// While stuck, the player quietly starts the video afresh this often, so it comes back by itself
// as soon as the Server PC does.
const RETRY_EVERY_MS = 12_000;

// Has the video reached its end? Asked this way because after a jump to the end while paused the
// browser does not always say "ended": the position can sit a hair before the last moment.
const atEnd = (v: HTMLVideoElement) => v.ended || (v.duration > 0 && v.duration - v.currentTime < 0.1);

// What the player is doing right now. Used when a teacher shows the video to a class.
export interface PlayerState { playing: boolean; position: number; rate: number }
const stateOf = (v: HTMLVideoElement): PlayerState => ({ playing: !v.paused && !v.ended, position: v.currentTime, rate: v.playbackRate });

type FullscreenDoc = Document & { webkitFullscreenElement?: Element | null; webkitFullscreenEnabled?: boolean; webkitExitFullscreen?: () => void };
type FullscreenBox = HTMLDivElement & { webkitRequestFullscreen?: () => void };

// The app's own video player: one big play button, and a single quiet row of controls under the
// picture. The row sits below the video, not on top of it, because a lesson often has writing right
// at the bottom edge and nothing should cover it. In full screen the row lies over the picture and
// fades away while the video plays. Made for a child at a lab PC and for a teacher at the smart board:
// big targets, plain words, the same on every machine (the browser's own controls differ on each).
// The picture is kept short enough that the controls under it are always on screen without scrolling.
// Keys: Space plays and pauses, the arrows jump 10 seconds, M is sound, F is full screen.
// `onState` hears every play, pause, jump and change of speed; `peek` lets the screen ask at any time.
// `layer` is laid over the picture (the writing a teacher does on the video); `onAspect` tells the
// screen the picture's shape for it, and `pause` lets the screen pause the video. `tools` sit in the
// row of controls. `plain` takes the big play button off the picture, out of the way of a pen.
export function VideoPlayer({ src, title, onError, onState, peek, pause, layer, onAspect, tools, plain }: {
  src: string; title: string; onError?: () => void; onState?: (s: PlayerState) => void; peek?: MutableRefObject<(() => PlayerState) | null>;
  pause?: MutableRefObject<(() => void) | null>; layer?: ReactNode; onAspect?: (aspect: number) => void; tools?: ReactNode; plain?: boolean;
}) {
  const t = useT();
  const video = useRef<HTMLVideoElement>(null);
  const box = useRef<FullscreenBox>(null);
  const hide = useRef<number | undefined>(undefined);
  const [playing, setPlaying] = useState(false);
  const [ended, setEnded] = useState(false);
  const [waiting, setWaiting] = useState(true);
  const [time, setTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loaded, setLoaded] = useState(0);
  const [muted, setMuted] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [full, setFull] = useState(false);
  const [awake, setAwake] = useState(true);
  const [broken, setBroken] = useState(false);
  // Once the video has been known to work, a later fault (the network dropped, the server restarted)
  // must not make the screen fetch the whole file another way: that could fill a lab PC's memory in
  // the middle of a lesson. It stops, says so, and "Try again" carries on from the same place.
  const known = useRef(false);
  const resumeAt = useRef(0);
  const resumePlaying = useRef(false);
  // The video stopped arriving (or broke) in the middle. The player stays on screen and says so.
  const [stuck, setStuck] = useState(false);
  // Changing this starts the video element afresh, at the place it had reached.
  const [attempt, setAttempt] = useState(0);
  const moved = useRef({ at: 0, when: 0 });
  // True from a fresh start until that fresh video is known again. Until then nothing has been put right.
  const retrying = useRef(false);
  const retry = useCallback(() => {
    retrying.current = true;
    const v = video.current;
    if (v) { resumeAt.current = v.currentTime || resumeAt.current; resumePlaying.current = resumePlaying.current || (!v.paused && !v.ended); }
    setWaiting(true);
    setAttempt((n) => n + 1);
  }, []);
  // The watchdog. The web view does not always say when a video has stopped arriving (it may just
  // wait for ever), so the player looks for itself: is the video meant to be moving, and is it?
  useEffect(() => {
    const t = setInterval(() => {
      const v = video.current;
      if (!v) return;
      const now = performance.now();
      const meant = v.seeking || (!v.paused && !v.ended);
      if (!v.error && !retrying.current && (!meant || v.currentTime !== moved.current.at)) {
        moved.current = { at: v.currentTime, when: now };
        if (!v.seeking) setStuck(false);
        return;
      }
      if (now - moved.current.when > SLOW_AFTER_MS) setWaiting(true);
      if (now - moved.current.when > STUCK_AFTER_MS) setStuck(true);
    }, 500);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!stuck) return;
    const t = setInterval(retry, RETRY_EVERY_MS);
    return () => clearInterval(t);
  }, [stuck, retry]);
  const canFull = typeof document !== 'undefined' && !!(document.fullscreenEnabled || (document as FullscreenDoc).webkitFullscreenEnabled);

  const wake = useCallback(() => {
    setAwake(true);
    window.clearTimeout(hide.current);
    hide.current = window.setTimeout(() => setAwake(false), HIDE_AFTER_MS);
  }, []);
  useEffect(() => () => window.clearTimeout(hide.current), []);
  useImperativeHandle(peek, () => () => (video.current ? stateOf(video.current) : { playing: false, position: 0, rate: 1 }), []);
  useImperativeHandle(pause, () => () => video.current?.pause(), []);
  const said = (e: { currentTarget: HTMLVideoElement }) => onState?.(stateOf(e.currentTarget));

  useEffect(() => {
    const onChange = () => setFull(!!(document.fullscreenElement || (document as FullscreenDoc).webkitFullscreenElement));
    document.addEventListener('fullscreenchange', onChange);
    document.addEventListener('webkitfullscreenchange', onChange);
    return () => { document.removeEventListener('fullscreenchange', onChange); document.removeEventListener('webkitfullscreenchange', onChange); };
  }, []);

  const toggle = () => {
    const v = video.current;
    if (!v) return;
    if (!v.paused) v.pause();
    else {
      if (atEnd(v)) v.currentTime = 0; // "Play again" starts from the beginning
      void v.play().catch(() => undefined);
    }
    wake();
  };
  // A jump is said at once, not when the video has finished getting there: a paused video that has to
  // fetch the new place may take seconds to finish, and the class's screens should not wait for that.
  const jump = (by: number) => { const v = video.current; if (!v) return; v.currentTime = Math.min(Math.max(0, v.currentTime + by), v.duration || 0); wake(); said({ currentTarget: v }); };
  const seek = (to: number) => { const v = video.current; if (!v) return; v.currentTime = to; setTime(to); wake(); said({ currentTarget: v }); };
  const sound = () => { const v = video.current; if (v) v.muted = !v.muted; wake(); };
  const faster = () => { const v = video.current; if (v) v.playbackRate = SPEEDS[(SPEEDS.indexOf(v.playbackRate) + 1) % SPEEDS.length]!; wake(); };
  const fullScreen = () => {
    const d = document as FullscreenDoc;
    // A PC may refuse full screen; the video then simply stays as it is.
    const asked = d.fullscreenElement || d.webkitFullscreenElement
      ? (d.exitFullscreen?.() ?? d.webkitExitFullscreen?.())
      : (box.current?.requestFullscreen?.() ?? box.current?.webkitRequestFullscreen?.());
    void Promise.resolve(asked).catch(() => undefined);
    wake();
  };

  const onKey = (e: KeyboardEvent) => {
    const act: Record<string, () => void> = { ' ': toggle, k: toggle, ArrowLeft: () => jump(-JUMP), ArrowRight: () => jump(JUMP), m: sound, f: () => canFull && fullScreen() };
    // Ctrl, Cmd and Alt combinations belong to the computer (Cmd+M minimises the window, and so on).
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const run = act[e.key.length === 1 ? e.key.toLowerCase() : e.key];
    // A focused button already answers Space by itself; pressing it there must not act twice.
    if (!run || (e.key === ' ' && e.target instanceof HTMLButtonElement)) return;
    e.preventDefault();
    run();
  };

  if (broken) {
    return <p className="rounded-3xl border border-dashed border-border p-10 text-center text-muted-foreground">{t('This video cannot be played on this PC. Tell your teacher.')}</p>;
  }

  // Under the picture the controls are always there; only in full screen do they hide.
  const shown = !full || awake || !playing;
  const pct = (n: number) => `${duration > 0 ? Math.min(100, (n / duration) * 100) : 0}%`;
  const Round = 'grid size-11 shrink-0 cursor-pointer place-items-center rounded-full text-white hover:bg-white/15 focus-visible:outline-white';

  return (
    <div
      ref={box} tabIndex={0} role="group" aria-label={t('Video: {title}', { title })} onKeyDown={onKey} onMouseMove={wake} onTouchStart={wake} onFocus={wake}
      // After a click or a touch on any control the keys go back to the player as a whole. Otherwise
      // Space would press the last button clicked again (for example leave full screen) instead of play and pause.
      onPointerUp={() => box.current?.focus({ preventScroll: true })}
      className={cn('mx-auto w-full overflow-hidden bg-black outline-none select-none focus-visible:ring-2 focus-visible:ring-ring', full ? 'relative h-full' : 'rounded-2xl shadow-sm', !shown && 'cursor-none')}
    >
      <div className={cn('relative', full && 'h-full')}>
        <video
          key={attempt} ref={video} src={src} playsInline preload="auto" disablePictureInPicture controlsList="nodownload noplaybackrate"
          className={cn('block w-full bg-black', full ? 'h-full object-contain' : 'aspect-video max-h-[calc(100vh-17rem)] min-h-40 object-contain')}
          onClick={toggle} onDoubleClick={() => canFull && fullScreen()} onContextMenu={(e) => e.preventDefault()}
          onPlay={(e) => { setPlaying(true); setEnded(false); wake(); said(e); }} onPause={(e) => { setPlaying(false); said(e); }} onEnded={() => { setPlaying(false); setEnded(true); }}
          // The end is also checked here: jumping to the end while paused sends no ended event.
          onTimeUpdate={(e) => { setTime(e.currentTarget.currentTime); setEnded(atEnd(e.currentTarget)); }} onSeeked={(e) => { setEnded(atEnd(e.currentTarget)); said(e); }} onDurationChange={(e) => setDuration(Number.isFinite(e.currentTarget.duration) ? e.currentTarget.duration : 0)}
          onProgress={(e) => { const b = e.currentTarget.buffered; setLoaded(b.length ? b.end(b.length - 1) : 0); }}
          // The spinner goes as soon as the video is known (its length has arrived). Some web views load
          // nothing more until Play is pressed, so waiting for "can play" would spin for ever there.
          onLoadedMetadata={(e) => {
            known.current = true;
            setWaiting(false);
            if (e.currentTarget.videoWidth && e.currentTarget.videoHeight) onAspect?.(e.currentTarget.videoWidth / e.currentTarget.videoHeight);
            // A fresh start after a fault carries on from the same place, playing if it was playing.
            if (resumeAt.current > 0) e.currentTarget.currentTime = resumeAt.current;
            if (resumePlaying.current) void e.currentTarget.play().catch(() => undefined);
            resumeAt.current = 0;
            resumePlaying.current = false;
            retrying.current = false;
            moved.current = { at: -1, when: performance.now() };
          }} onWaiting={() => setWaiting(true)} onCanPlay={() => setWaiting(false)} onPlaying={() => setWaiting(false)}
          onVolumeChange={(e) => setMuted(e.currentTarget.muted)} onRateChange={(e) => { setSpeed(e.currentTarget.playbackRate); said(e); }}
          onError={(e) => {
            // Never worked: let the screen try another way, or say it cannot be played here.
            if (!known.current) return onError ? onError() : setBroken(true);
            // Worked and then broke: stay, say so, and keep trying from the same place.
            resumeAt.current = e.currentTarget.currentTime || resumeAt.current;
            resumePlaying.current = resumePlaying.current || playing;
            setStuck(true);
          }}
        />

        <SchoolMark />
        {/* The one loud thing: a big button in the middle whenever the video is not playing. */}
        {layer}
        {!playing && !waiting && !stuck && !plain && (
          <button type="button" onClick={toggle} aria-label={ended ? t('Play again') : t('Play')} className="absolute top-1/2 left-1/2 grid size-20 -translate-x-1/2 -translate-y-1/2 cursor-pointer place-items-center rounded-full bg-primary text-primary-foreground shadow-lg transition-transform hover:scale-105 focus-visible:outline-white">
            {ended ? <RotateCcw className="size-8" strokeWidth={2.25} /> : <Play className="ml-1 size-9 fill-current" strokeWidth={0} />}
          </button>
        )}
        {stuck && (
        <div className="absolute inset-0 grid place-content-center justify-items-center gap-4 bg-black/75 p-6 text-center text-white" role="alert">
          <p className="max-w-md text-lg font-medium">{t('The video has stopped loading. Check that the Server PC is switched on.')}</p>
          <p className="text-sm text-white/70">{t('It will carry on by itself when the Server PC is back.')}</p>
          <Button variant="quiet" onClick={retry}>{t('Try again')}</Button>
        </div>
      )}
      {waiting && !stuck && <div role="status" aria-label={t('Loading')} className="pointer-events-none absolute top-1/2 left-1/2 size-12 -translate-x-1/2 -translate-y-1/2 animate-spin rounded-full border-4 border-white/25 border-t-white motion-reduce:animate-none" />}
      </div>

      <div className={cn('px-3 pb-2 transition-opacity duration-200', full ? 'absolute inset-x-0 bottom-0 bg-linear-to-t from-black/85 to-transparent pt-10' : 'bg-[hsl(222_30%_10%)] pt-1.5', shown ? 'opacity-100' : 'pointer-events-none opacity-0')}>
        <input
          type="range" className="player-seek" aria-label={t('Where you are in the video')} aria-valuetext={t('{time} of {total}', { time: clock(time), total: clock(duration) })}
          min={0} max={duration || 0} step={0.1} value={Math.min(time, duration || 0)} disabled={duration === 0}
          onChange={(e) => seek(Number(e.target.value))} onKeyDown={(e) => { if (e.key.startsWith('Arrow')) e.preventDefault(); }}
          style={{ '--played': pct(time), '--loaded': pct(Math.max(loaded, time)) } as React.CSSProperties}
        />
        <div className="flex flex-wrap items-center gap-1 text-white">
          <button type="button" className={Round} onClick={toggle} aria-label={playing ? t('Pause') : t('Play')}>{playing ? <Pause className="size-5 fill-current" strokeWidth={0} /> : <Play className="size-5 fill-current" strokeWidth={0} />}</button>
          <button type="button" className={Round} onClick={() => jump(-JUMP)} aria-label={t('Back {n} seconds', { n: JUMP })}><RotateCcw className="size-5" /></button>
          <button type="button" className={Round} onClick={() => jump(JUMP)} aria-label={t('Forward {n} seconds', { n: JUMP })}><RotateCw className="size-5" /></button>
          <span className="px-2 text-sm font-medium tabular-nums">{clock(time)} <span className="text-white/60">/ {clock(duration)}</span></span>
          {tools}
          <span className="flex-1" />
          <button type="button" className={cn(Round, 'w-auto min-w-11 px-3 text-sm font-semibold tabular-nums')} onClick={faster} aria-label={t('Speed {speed} times. Press to change', { speed })}>{speed}×</button>
          <button type="button" className={Round} onClick={sound} aria-label={muted ? t('Turn sound on') : t('Turn sound off')}>{muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}</button>
          {canFull && <button type="button" className={Round} onClick={fullScreen} aria-label={full ? t('Leave full screen') : t('Full screen')}>{full ? <Minimize className="size-5" /> : <Maximize className="size-5" />}</button>}
        </div>
      </div>
    </div>
  );
}
