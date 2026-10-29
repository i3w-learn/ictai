import { useState } from 'react';
import type { StudentRunState } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Centered, PageTitle } from '../../ui/ui';
import { AuditPanel } from './AuditPanel';
import { DevicesPanel } from './DevicesPanel';
import { StaffPanel } from './StaffPanel';
import { StudentsPanel } from './StudentsPanel';
import { JoinQuiz } from '../quizzes/JoinQuiz';
import { LabSession } from '../quizzes/LabSession';
import { PlayQuiz } from '../quizzes/PlayQuiz';
import { QuizEditor } from '../quizzes/QuizEditor';
import { QuizzesPanel } from '../quizzes/QuizzesPanel';

// The console's pages besides the dashboard.
type View = { kind: 'dash' } | { kind: 'edit-quiz'; quizId: string | null } | { kind: 'lab'; runId: string };

function greeting() {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening';
}

export function Home() {
  const { state } = useApp();
  const p = state.session!.principal;
  const [view, setView] = useState<View>({ kind: 'dash' });
  const [playing, setPlaying] = useState<StudentRunState | null>(null);

  if (p.kind === 'student') {
    if (playing) return <PlayQuiz initial={playing} onExit={() => setPlaying(null)} />;
    return (
      <Centered>
        <PageTitle eyebrow={greeting()} sub="When your teacher starts a lesson, it will open here.">Hello, {p.name}</PageTitle>
        <JoinQuiz onJoined={setPlaying} />
      </Centered>
    );
  }

  if (p.kind === 'staff' && state.settings.role === 'console') {
    if (view.kind === 'edit-quiz') return <QuizEditor quizId={view.quizId} onDone={() => setView({ kind: 'dash' })} />;
    if (view.kind === 'lab') return <LabSession runId={view.runId} onExit={() => setView({ kind: 'dash' })} />;
    const today = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
    return (
      <div className="mx-auto grid max-w-6xl gap-8">
        <header className="border-b border-border pb-7">
          <PageTitle eyebrow={`${today} · ${greeting()}, ${p.displayName}`}>Your lab today</PageTitle>
        </header>
        {p.permissions.includes('teaching.manage') && (
          <QuizzesPanel onEdit={(quizId) => setView({ kind: 'edit-quiz', quizId })} onLab={(runId) => setView({ kind: 'lab', runId })} />
        )}
        {p.permissions.includes('staff.manage') && <StaffPanel />}
        {p.permissions.includes('setup.devices') && <DevicesPanel />}
        {p.permissions.includes('students.manage') && <StudentsPanel />}
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
