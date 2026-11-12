import { useState } from 'react';
import type { StudentRunState } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, Centered, PageTitle, Panel } from '../../ui/ui';
import { AuditPanel } from './AuditPanel';
import { DevicesPanel } from './DevicesPanel';
import { StaffPanel } from './StaffPanel';
import { StudentsPanel } from './StudentsPanel';
import { JoinQuiz } from '../quizzes/JoinQuiz';
import { LabSession } from '../quizzes/LabSession';
import { PlayQuiz } from '../quizzes/PlayQuiz';
import { QuizEditor } from '../quizzes/QuizEditor';
import { QuizzesPanel } from '../quizzes/QuizzesPanel';
import { AiQuizMaker, type AiDraft } from '../quizzes/AiQuizMaker';
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
  | { kind: 'student'; studentId: string };

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function Home() {
  const { state } = useApp();
  const p = state.session!.principal;
  const [view, setView] = useState<View>({ kind: 'dash' });
  const [playing, setPlaying] = useState<StudentRunState | null>(null);
  // Goes up each time a class is added, so the teacher form shows the new class at once.
  const [classesChanged, setClassesChanged] = useState(0);
  const [notesOpen, setNotesOpen] = useState(false);

  if (p.kind === 'student') {
    if (playing) return <PlayQuiz initial={playing} onExit={() => setPlaying(null)} />;
    if (notesOpen) return <MyNotes onBack={() => setNotesOpen(false)} />;
    return (
      <Centered>
        <PageTitle eyebrow={greeting()} sub="When your teacher starts a lesson, it will open here.">Hello, {p.name}</PageTitle>
        <JoinQuiz onJoined={setPlaying} />
        <Panel title="My notes" actions={<Button variant="quiet" onClick={() => setNotesOpen(true)}>Open my notes</Button>}>
          <p className="text-sm text-muted-foreground">Write down what you learn. Only you can read your notes.</p>
        </Panel>
      </Centered>
    );
  }

  if (p.kind === 'staff' && state.settings.role === 'console') {
    if (view.kind === 'edit-quiz') return <QuizEditor quizId={view.quizId} draft={view.draft} onDone={() => setView({ kind: 'dash' })} />;
    if (view.kind === 'ai-quiz') return <AiQuizMaker onDraft={(draft) => setView({ kind: 'edit-quiz', quizId: null, draft })} onBack={() => setView({ kind: 'dash' })} />;
    if (view.kind === 'lab') return <LabSession runId={view.runId} onExit={() => setView({ kind: 'dash' })} />;
    if (view.kind === 'student') return <StudentResultsPage studentId={view.studentId} onBack={() => setView({ kind: 'dash' })} />;
    const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    return (
      <div className="mx-auto grid max-w-6xl gap-8">
        <header className="border-b border-border pb-7">
          <PageTitle eyebrow={`${today} · ${greeting()}, ${p.displayName}`}>Your lab today</PageTitle>
        </header>
        {p.permissions.includes('results.view') && <ResultsPanel onStudent={(studentId) => setView({ kind: 'student', studentId })} />}
        {p.permissions.includes('teaching.manage') && (
          <QuizzesPanel onEdit={(quizId) => setView({ kind: 'edit-quiz', quizId })} onLab={(runId) => setView({ kind: 'lab', runId })} onAi={() => setView({ kind: 'ai-quiz' })} />
        )}
        {p.permissions.includes('staff.manage') && <TeachersPanel />}
        {p.permissions.includes('staff.manage') && <StaffPanel classesChanged={classesChanged} />}
        {p.permissions.includes('setup.devices') && <DevicesPanel />}
        {p.permissions.includes('students.manage') && <StudentsPanel onClassAdded={() => setClassesChanged((n) => n + 1)} />}
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
