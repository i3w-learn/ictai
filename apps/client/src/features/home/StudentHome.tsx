import { useEffect, useState } from 'react';
import { BookOpen, Film, ChartColumn, House, ListChecks, NotebookPen, PencilLine, SlidersHorizontal, Sparkles } from 'lucide-react';
import { DEFAULT_PREFS, type StudentPrefs, type StudentRunState } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Shell, SideMenu, type MenuItem } from '../../ui/dashboard';
import { cn, useAction } from '../../ui/ui';
import { MyBooks } from '../content/MyBooks';
import { StudentNotices } from '../notices/StudentNotices';
import { MyNotes } from '../notes/MyNotes';
import { HowIAmDoing } from '../progress/HowIAmDoing';
import { PollPopup, useOpenPoll } from '../polls/PollPopup';
import { PlayQuiz } from '../quizzes/PlayQuiz';
import { QuizPopup, QuizWaiting, useOpenQuiz } from '../quizzes/QuizInvite';
import { ThingsToDo } from '../sequences/ThingsToDo';
import { StudentSettings } from '../settings/StudentSettings';
import { applyPrefs } from '../settings/prefs';
import { ClassShow, useClassShow } from '../shows/ClassShow';
import { AskTutor } from '../tutor/AskTutor';
import { MyWork } from '../work/MyWork';
import { StudentDashboard } from './StudentDashboard';

type Page = 'home' | 'todo' | 'books' | 'videos' | 'work' | 'progress' | 'notes' | 'settings' | 'ask';
const MENU: MenuItem<Exclude<Page, 'ask'>>[] = [
  { key: 'home', label: 'Home', icon: House },
  { key: 'todo', label: 'Things to do', icon: ListChecks },
  { key: 'books', label: 'My books', icon: BookOpen },
  { key: 'videos', label: 'Videos', icon: Film },
  { key: 'work', label: 'My work', icon: PencilLine },
  { key: 'progress', label: 'How I am doing', icon: ChartColumn },
  { key: 'notes', label: 'My notes', icon: NotebookPen },
  { key: 'settings', label: 'Settings', icon: SlidersHorizontal },
];

// The student's own screens, one per item in the side menu. A quiz the teacher opens for the class
// pops up over any of them.
export function StudentHome({ name }: { name: string }) {
  const [page, setPage] = useState<Page>('home');
  const [playing, setPlaying] = useState<StudentRunState | null>(null);
  // The quiz the student said "Not now" to; a different quiz pops up again.
  const [later, setLater] = useState<string | null>(null);
  const { quiz, clear: clearQuiz } = useOpenQuiz();
  // A quick question from the teacher (a poll). It pops up until the student answers it or says "Not now".
  const { poll, set: setPoll } = useOpenPoll();
  const [pollLater, setPollLater] = useState<string | null>(null);
  // A video the teacher is showing the class right now. It lies over every screen below.
  const classShow = useClassShow();
  const { call } = useApp();
  // The student's own text size, colours and font. Put on at sign-in, taken off when this screen goes
  // (sign-out), so they never stay on the PC for the next student.
  const [prefs, setPrefs] = useState<StudentPrefs>(DEFAULT_PREFS);
  useEffect(() => {
    let alive = true;
    call('GET /api/v1/me/prefs').then((p) => { if (alive) { setPrefs(p); applyPrefs(p); } }, () => undefined);
    return () => { alive = false; applyPrefs(null); };
  }, [call]);
  // Shown at once, then saved. If saving fails the student still sees their choice and is told.
  const savePrefs = useAction(async (p: StudentPrefs) => {
    setPrefs(p);
    applyPrefs(p);
    await call('PUT /api/v1/me/prefs', { body: p });
  });

  // A quiz takes the whole page, with no menu to wander off into. "Back to home" after it means
  // home, not the page the quiz popped up over.
  if (playing) return <Shell><PlayQuiz initial={playing} onExit={() => { setPlaying(null); clearQuiz(); setPage('home'); }} /></Shell>;

  // The one warm-coloured thing on the screen, so "I am stuck" is always easy to find.
  const ask = (
    <button
      type="button" title="Ask a question" aria-current={page === 'ask' ? 'page' : undefined} onClick={() => setPage('ask')}
      className={cn('ui-ask flex w-full cursor-pointer items-center justify-center gap-2 rounded-2xl bg-[hsl(20_85%_42%)] p-3 text-left text-white transition-shadow hover:shadow-lg lg:flex-col lg:items-start lg:p-4', page === 'ask' && 'ring-2 ring-foreground ring-offset-2 ring-offset-card')}
    >
      <span className="ui-bubble grid size-9 shrink-0 place-items-center rounded-xl bg-white/20 lg:size-12 lg:rounded-2xl"><Sparkles className="size-5 lg:size-6" /></span>
      <span className="hidden lg:block">
        <span className="block font-display text-lg font-semibold">Ask a question</span>
        <span className="text-sm text-white/85">Stuck on something? Get a hint in simple words.</span>
      </span>
    </button>
  );
  return (
    <Shell menu={<SideMenu label="Your pages" items={MENU} current={page as Exclude<Page, 'ask'>} onPick={setPage} footer={ask} />}>
      {classShow && <ClassShow live={classShow} />}
      {/* While the teacher is showing a video, a quiz that is open waits: its popup would lie over the
          video, and over the pen of a student the teacher has asked to write on it. It comes up when the video goes. */}
      {quiz && quiz.runId !== later && !classShow && <QuizPopup quiz={quiz} onJoined={setPlaying} onLater={() => setLater(quiz.runId)} />}
      {/* A poll waits behind the teacher's video and behind a quiz popup, like the quiz does. */}
      {poll && poll.myChoice === null && poll.id !== pollLater && !classShow && !(quiz && quiz.runId !== later) && <PollPopup poll={poll} onAnswered={setPoll} onLater={() => setPollLater(poll.id)} />}
      {page === 'home' && (
        <StudentDashboard
          name={name} go={setPage}
          top={<>{quiz && <QuizWaiting quiz={quiz} onJoined={setPlaying} />}<StudentNotices /></>}
        />
      )}
      {page === 'todo' && <ThingsToDo onWork={() => setPage('work')} />}
      {page === 'books' && <MyBooks />}
      {page === 'videos' && <MyBooks key="videos" videos />}
      {page === 'work' && <MyWork />}
      {page === 'progress' && <HowIAmDoing onWork={() => setPage('work')} />}
      {page === 'notes' && <MyNotes />}
      {page === 'ask' && <AskTutor />}
      {page === 'settings' && <StudentSettings prefs={prefs} onChange={(p) => void savePrefs.run(p)} error={savePrefs.error} />}
    </Shell>
  );
}
