import { useEffect, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { DEFAULT_PREFS, type ContentItem, type StudentPrefs, type StudentRunState } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, Centered, PageTitle, Panel, useAction } from '../../ui/ui';
import { AuditPanel } from './AuditPanel';
import { DevicesPanel } from './DevicesPanel';
import { StaffPanel } from './StaffPanel';
import { StudentsPanel } from './StudentsPanel';
import { QuizPopup, QuizWaiting, useOpenQuiz } from '../quizzes/QuizInvite';
import { LabSession } from '../quizzes/LabSession';
import { PlayQuiz } from '../quizzes/PlayQuiz';
import { QuizEditor } from '../quizzes/QuizEditor';
import { QuizzesPanel } from '../quizzes/QuizzesPanel';
import { AiQuizMaker, type AiDraft } from '../quizzes/AiQuizMaker';
import { AskAi } from '../quizzes/AskAi';
import { ContentPanel } from '../content/ContentPanel';
import { MyBooks } from '../content/MyBooks';
import { Viewer } from '../content/Viewer';
import { NoticesPanel } from '../notices/NoticesPanel';
import { HowIAmDoing } from '../progress/HowIAmDoing';
import { ReportCardsPanel } from '../report-cards/ReportCardsPanel';
import { StudentNotices } from '../notices/StudentNotices';
import { SequencesPanel } from '../sequences/SequencesPanel';
import { ThingsToDo } from '../sequences/ThingsToDo';
import { SettingsPanel } from '../settings/SettingsPanel';
import { StudentSettings } from '../settings/StudentSettings';
import { applyPrefs } from '../settings/prefs';
import { LabToday } from '../timetable/LabToday';
import { TimetablePanel } from '../timetable/TimetablePanel';
import { AskTutor } from '../tutor/AskTutor';
import { MarkWork } from '../work/MarkWork';
import { MyWork } from '../work/MyWork';
import { WorkPanel } from '../work/WorkPanel';
import { MyNotes } from '../notes/MyNotes';
import { ResultsPanel } from '../results/ResultsPanel';
import { StudentResultsPage } from '../results/StudentResultsPage';
import { TeachersPanel } from '../results/TeachersPanel';

// The console's pages besides the dashboard.
type View =
  | { kind: 'dash' }
  | { kind: 'edit-quiz'; quizId: string | null; draft?: AiDraft }
  | { kind: 'lab'; runId: string }
  | { kind: 'ai-quiz' }
  | { kind: 'ask-ai' }
  | { kind: 'mark-work'; id: string }
  | { kind: 'content'; item: ContentItem }
  | { kind: 'student'; studentId: string };

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function Home() {
  const { state } = useApp();
  const p = state.session!.principal;
  const [view, setView] = useState<View>({ kind: 'dash' });
  // Goes up when one panel changes something another panel lists (a class, a period, a library item, a
  // piece of work), so every panel shows it at once.
  const [refresh, setRefresh] = useState(0);
  const changed = () => setRefresh((n) => n + 1);

  if (p.kind === 'student') return <StudentHome name={p.name} />;
  if (p.kind === 'staff' && state.settings.role === 'console') {
    if (view.kind === 'edit-quiz') return <QuizEditor quizId={view.quizId} draft={view.draft} onDone={() => setView({ kind: 'dash' })} />;
    if (view.kind === 'ai-quiz') return <AiQuizMaker onDraft={(draft) => setView({ kind: 'edit-quiz', quizId: null, draft })} onBack={() => setView({ kind: 'dash' })} />;
    if (view.kind === 'content') return <Viewer item={view.item} onBack={() => setView({ kind: 'dash' })} />;
    if (view.kind === 'mark-work') return <MarkWork id={view.id} onBack={() => setView({ kind: 'dash' })} />;
    if (view.kind === 'ask-ai') return <AskAi onBack={() => setView({ kind: 'dash' })} />;
    if (view.kind === 'lab') return <LabSession runId={view.runId} onExit={() => setView({ kind: 'dash' })} />;
    if (view.kind === 'student') return <StudentResultsPage studentId={view.studentId} onBack={() => setView({ kind: 'dash' })} />;
    const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    return (
      <div className="mx-auto grid max-w-6xl gap-8">
        <header className="border-b border-border pb-7">
          <PageTitle eyebrow={`${today} · ${greeting()}, ${p.displayName}`}>Your lab today</PageTitle>
        </header>
        {p.permissions.includes('results.view') && <ResultsPanel refresh={refresh} onStudent={(studentId) => setView({ kind: 'student', studentId })} />}
        {p.permissions.includes('teaching.manage') && (
          <QuizzesPanel refresh={refresh} onEdit={(quizId) => setView({ kind: 'edit-quiz', quizId })} onLab={(runId) => setView({ kind: 'lab', runId })} onAi={() => setView({ kind: 'ai-quiz' })} onAsk={() => setView({ kind: 'ask-ai' })} />
        )}
        {p.permissions.includes('teaching.manage') && <ContentPanel refresh={refresh} onChanged={changed} onOpen={(item) => setView({ kind: 'content', item })} />}
        {p.permissions.includes('teaching.manage') && <SequencesPanel refresh={refresh} />}
        {p.permissions.includes('results.view') && <ReportCardsPanel refresh={refresh} />}
        {p.permissions.includes('teaching.manage') && <WorkPanel refresh={refresh} onChanged={changed} onOpen={(id) => setView({ kind: 'mark-work', id })} />}
        {p.permissions.includes('setup.timetable') && <TimetablePanel refresh={refresh} />}
        {p.permissions.includes('teaching.manage') && <NoticesPanel refresh={refresh} />}
        {p.permissions.includes('staff.manage') && <TeachersPanel />}
        {p.permissions.includes('staff.manage') && <StaffPanel classesChanged={refresh} />}
        {p.permissions.includes('setup.devices') && <DevicesPanel />}
        {p.permissions.includes('students.manage') && <StudentsPanel onClassAdded={changed} />}
        {p.permissions.includes('settings.manage') && <SettingsPanel onSaved={changed} />}
        {p.permissions.includes('server.manage') && <AuditPanel />}
      </div>
    );
  }

  return (
    <Centered>
      <PageTitle sub="Live lessons arrive in the next milestone (M2).">Ready, {p.kind === 'staff' ? p.displayName : 'device'}</PageTitle>
    </Centered>
  );
}

// The student's own screens. A quiz the teacher opens for the class pops up over any of them.
function StudentHome({ name }: { name: string }) {
  const [playing, setPlaying] = useState<StudentRunState | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  // The quiz the student said "Not now" to; a different quiz pops up again.
  const [later, setLater] = useState<string | null>(null);
  const quiz = useOpenQuiz();
  const { call } = useApp();
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [workOpen, setWorkOpen] = useState(false);
  const [progressOpen, setProgressOpen] = useState(false);
  const [tutorOpen, setTutorOpen] = useState(false);
  const [booksOpen, setBooksOpen] = useState(false);
  const [todoOpen, setTodoOpen] = useState(false);
  // The student's own text size, colours and font. Put on at sign-in, taken off when this screen goes
  // (sign-out), so they never stay on the PC for the next student.
  const [prefs, setPrefs] = useState<StudentPrefs>(DEFAULT_PREFS);
  useEffect(() => {
    let alive = true;
    call('GET /api/v1/me/prefs').then((p) => { if (alive) { setPrefs(p); applyPrefs(p); } }, () => undefined);
    return () => { alive = false; applyPrefs(null); };
  }, []);
  // Shown at once, then saved. If saving fails the student still sees their choice and is told.
  const savePrefs = useAction(async (p: StudentPrefs) => {
    setPrefs(p);
    applyPrefs(p);
    await call('PUT /api/v1/me/prefs', { body: p });
  });

  if (playing) return <PlayQuiz initial={playing} onExit={() => setPlaying(null)} />;
  const popup = quiz && quiz.runId !== later && <QuizPopup quiz={quiz} onJoined={setPlaying} onLater={() => setLater(quiz.runId)} />;
  if (notesOpen) return <>{popup}<MyNotes onBack={() => setNotesOpen(false)} /></>;
  if (progressOpen) return <>{popup}<HowIAmDoing onBack={() => setProgressOpen(false)} onWork={() => { setProgressOpen(false); setWorkOpen(true); }} /></>;
  if (todoOpen) return <>{popup}<ThingsToDo onBack={() => setTodoOpen(false)} onWork={() => { setTodoOpen(false); setWorkOpen(true); }} /></>;
  if (booksOpen) return <>{popup}<MyBooks onBack={() => setBooksOpen(false)} /></>;
  if (tutorOpen) return <>{popup}<AskTutor onBack={() => setTutorOpen(false)} /></>;
  if (workOpen) return <>{popup}<MyWork onBack={() => setWorkOpen(false)} /></>;
  if (settingsOpen) return <>{popup}<StudentSettings prefs={prefs} onChange={(p) => void savePrefs.run(p)} error={savePrefs.error} onBack={() => setSettingsOpen(false)} /></>;
  return (
    <Centered>
      {popup}
      <PageTitle eyebrow={greeting()} sub="When your teacher starts a quiz, it will open here.">Hello, {name}</PageTitle>
      <LabToday />
      {quiz && <QuizWaiting quiz={quiz} onJoined={setPlaying} />}
      <StudentNotices />
      <Panel title="Things to do" actions={<Button variant="quiet" onClick={() => setTodoOpen(true)}>Open things to do</Button>}>
        <p className="text-sm text-muted-foreground">Steps your teacher has put in order for you, with a tick for each one you finish.</p>
      </Panel>
      <Panel title="My books" actions={<Button variant="quiet" onClick={() => setBooksOpen(true)}>Open my books</Button>}>
        <p className="text-sm text-muted-foreground">Books, pictures and videos your teachers have added for your class.</p>
      </Panel>
      <Panel title="My work" actions={<Button variant="quiet" onClick={() => setWorkOpen(true)}>Open my work</Button>}>
        <p className="text-sm text-muted-foreground">Work your teacher has set: write your answer and hand it in.</p>
      </Panel>
      <Panel title="Ask" actions={<Button variant="quiet" onClick={() => setTutorOpen(true)}>Ask a question</Button>}>
        <p className="text-sm text-muted-foreground">Stuck on something? Ask, and get a hint in simple words.</p>
      </Panel>
      <Panel title="How I am doing" actions={<Button variant="quiet" onClick={() => setProgressOpen(true)}>See how I am doing</Button>}>
        <p className="text-sm text-muted-foreground">Your quiz results and work, and what to try next. Only you can see it.</p>
      </Panel>
      <Panel title="My notes" actions={<Button variant="quiet" onClick={() => setNotesOpen(true)}>Open my notes</Button>}>
        <p className="text-sm text-muted-foreground">Write down what you learn. Only you can read your notes.</p>
      </Panel>
      <div><Button variant="quiet" onClick={() => setSettingsOpen(true)}><SlidersHorizontal className="size-4" /> Settings</Button></div>
    </Centered>
  );
}
