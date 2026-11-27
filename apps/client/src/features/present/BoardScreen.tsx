import { useEffect, useState } from 'react';
import { GraduationCap, X } from 'lucide-react';
import { useApp } from '../../app/app-context';
import { useT } from '../../i18n/i18n';
import { ClassShow, type LiveShow } from '../shows/ClassShow';
import { hearConsole } from './present-link';

// The board window: the app's second window, for a board plugged into the Server PC as a second
// screen. It shows only what the teacher is showing to a class: the video, the book's page or the
// whiteboard, with no buttons of the console around it. The teacher can write on it by touch.
// The console tells it who is signed in and what is shown; between lessons it waits.
export function BoardScreen() {
  const { platform, state, dispatch } = useApp();
  const t = useT();
  const board = platform.present;
  const [live, setLive] = useState<LiveShow | null>(null);
  useEffect(() => {
    if (!board) return;
    return hearConsole(board, (news) => {
      dispatch({ type: 'session', session: news.session });
      setLive(news.show ? { show: news.show, gotAt: performance.now() - news.showAge } : null);
    });
  }, [board, dispatch]);

  return (
    <div className="grid h-screen w-full place-items-center bg-foreground p-8 text-center text-background">
      <div className="grid justify-items-center gap-5">
        <span className="grid size-24 place-items-center rounded-full bg-background/15"><GraduationCap className="size-11" strokeWidth={1.75} /></span>
        {state.settings.server && <p className="text-2xl font-semibold text-background/80">{state.settings.server.name}</p>}
        <h1 className="font-display text-5xl font-semibold tracking-tight">{t('Waiting for the lesson')}</h1>
        <p className="max-w-xl text-xl text-background/80">{state.session
          ? t('When the teacher shows a video, a book or the whiteboard to a class, it appears here.')
          : t('Sign in on the Server PC to use the board.')}</p>
      </div>
      <button type="button" onClick={() => void board?.close().catch(() => undefined)} className="fixed top-4 right-4 flex min-h-11 cursor-pointer items-center gap-2 rounded-full px-4 text-sm font-semibold text-background/70 hover:bg-background/15 focus-visible:outline-background">
        <X className="size-4" /> {t('Close this window')}
      </button>
      {/* Over the waiting words, as on a student PC. Only for someone signed in: the show's calls need it. */}
      {state.session && live && <ClassShow live={live} onBoard />}
    </div>
  );
}
