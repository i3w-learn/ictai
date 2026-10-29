import { useEffect } from 'react';
import { ArrowLeft, Check, Trophy } from 'lucide-react';
import { quizRoom, type TeacherRunState } from '@ict/contracts';
import { useApp, useLiveState } from '../../app/app-context';
import { Button, ConfirmButton, ErrorNote, Panel, useAction } from '../../ui/ui';
import { RelayChip } from './RelayChip';

const STATUS = { lobby: 'Waiting to start', active: 'Live', ended: 'Ended' } as const;

// Lab Mode for the teacher (v2's LabSession): code, who joined, live progress, leaderboard.
export function LabSession({ runId, onExit }: { runId: string; onExit: () => void }) {
  const { call } = useApp();
  const read = () => call('GET /api/v1/quiz-runs/:id', { params: { id: runId } });
  const [run, setFirst] = useLiveState<TeacherRunState>(quizRoom(runId), null, read);

  // REST gives the first picture even before the relay is up; after that the relay keeps it fresh.
  const load = useAction(async () => setFirst(await read()));
  useEffect(() => { void load.run(); }, [runId]);

  const start = useAction(async () => setFirst(await call('POST /api/v1/quiz-runs/:id/start', { params: { id: runId } })));
  const end = useAction(async () => setFirst(await call('POST /api/v1/quiz-runs/:id/end', { params: { id: runId } })));

  if (!run) return <ErrorNote message={load.error} />;
  const done = run.participants.filter((p) => p.finished).length;

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="quiet" onClick={onExit}><ArrowLeft className="size-4" /> Quizzes</Button>
        <h1 className="flex-1 font-display text-2xl font-semibold">{run.title} <span className="text-base font-normal text-muted-foreground">· Class {run.className}</span></h1>
        <RelayChip />
        <span className={run.status === 'active' ? 'rounded-full bg-success/10 px-3 py-1 text-sm font-semibold text-success' : 'rounded-full bg-secondary px-3 py-1 text-sm font-semibold text-secondary-foreground'}>
          {STATUS[run.status]}
        </span>
      </div>

      {run.joinCode && (
        <div className="grid justify-items-center gap-2 rounded-2xl border-2 border-dashed border-primary/40 bg-primary/5 p-8">
          <span className="text-sm text-muted-foreground">Students: tap <b>Join a quiz</b> and type</span>
          <strong className="font-mono text-6xl tracking-[0.2em] text-primary">{run.joinCode}</strong>
          <span className="text-sm text-muted-foreground">{run.participants.length} joined · {run.questionCount} questions · {run.totalMarks} marks</span>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        {run.status === 'lobby' && <Button disabled={start.busy} onClick={() => start.run()}>Start quiz</Button>}
        {run.status !== 'ended' && <ConfirmButton question="End the quiz for everyone?" onConfirm={() => void end.run()}>End quiz</ConfirmButton>}
        {run.status === 'active' && <span className="self-center text-sm text-muted-foreground">{done} of {run.participants.length} finished</span>}
      </div>
      <ErrorNote message={start.error ?? end.error} />

      {run.status === 'lobby' ? (
        <Panel title={`Students joined · ${run.participants.length}`}>
          {run.participants.length === 0 ? (
            <p className="text-muted-foreground">Nobody yet. Names appear here as students join.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {run.participants.map((p) => <span key={p.studentId} className="rounded-full bg-primary/10 px-3 py-1 text-sm font-medium text-primary">{p.name}</span>)}
            </div>
          )}
        </Panel>
      ) : (
        <Panel title={run.status === 'ended' ? 'Leaderboard' : 'Live progress'}>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-[11px] tracking-[0.14em] text-muted-foreground uppercase">
                <th className="w-10 py-2.5 pr-3 font-semibold">#</th>
                <th className="py-2.5 pr-3 font-semibold">Student</th>
                <th className="py-2.5 pr-3 font-semibold">Answered</th>
                <th className="py-2.5 pr-3 font-semibold">Correct</th>
                <th className="py-2.5 pr-3 font-semibold">Score</th>
                <th className="py-2.5 font-semibold">Done</th>
              </tr>
            </thead>
            <tbody>
              {run.participants.map((p, i) => (
                <tr key={p.studentId} className="border-b border-border last:border-0">
                  <td className="py-3 pr-3 tabular-nums text-muted-foreground">{run.status === 'ended' && i < 3 ? <Trophy className="size-4 text-primary" /> : i + 1}</td>
                  <td className="py-3 pr-3 font-medium">{p.name}</td>
                  <td className="py-3 pr-3 tabular-nums">{p.answered} / {run.questionCount}</td>
                  <td className="py-3 pr-3 tabular-nums">{p.correct}</td>
                  <td className="py-3 pr-3 font-semibold tabular-nums">{p.score} / {run.totalMarks}</td>
                  <td className="py-3">{p.finished && <Check className="size-4 text-success" />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}
