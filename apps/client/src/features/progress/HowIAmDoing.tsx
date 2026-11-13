import { useEffect, useState } from 'react';
import { ArrowLeft, Lightbulb } from 'lucide-react';
import type { MyProgress } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, Card, ErrorNote, PageTitle, useAction } from '../../ui/ui';

const day = (at: number) => new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

// PRD student app "How I am doing": the student's own quiz results and work, and one thing to try next.
// A student only ever sees their own numbers here.
export function HowIAmDoing({ onBack, onWork }: { onBack: () => void; onWork: () => void }) {
  const { call } = useApp();
  const [p, setP] = useState<MyProgress | null>(null);
  const load = useAction(async () => setP(await call('GET /api/v1/me/progress')));
  useEffect(() => { void load.run(); }, []);

  const nothingYet = p && p.quizzes.taken === 0 && p.work.set === 0;
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-5">
      <div><Button variant="quiet" onClick={onBack}><ArrowLeft className="size-4" /> Back</Button></div>
      <PageTitle sub="Only you can see this.">How I am doing</PageTitle>
      <ErrorNote message={load.error} />
      {nothingYet && <p className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">Nothing to show yet. After your first quiz or piece of work, your results will be here.</p>}

      {p && !nothingYet && (
        <>
          {p.tryNext && (
            <Card className="flex flex-wrap items-center gap-3 border-primary/30 bg-primary/5 p-5">
              <Lightbulb className="size-6 shrink-0 text-primary" />
              <p className="min-w-48 flex-1 text-lg">
                <b>Try this next: </b>
                {p.tryNext.kind === 'work'
                  ? <>hand in <b>{p.tryNext.title}</b>. It is past its date.</>
                  : <>practise <b>{p.tryNext.subject}</b>. Your quiz average there is {p.tryNext.average}%.</>}
              </p>
              {p.tryNext.kind === 'work' && <Button onClick={onWork}>Open my work</Button>}
            </Card>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label="Quizzes taken" value={String(p.quizzes.taken)} />
            <Stat label="Quiz average" value={p.quizzes.average === null ? '–' : `${p.quizzes.average}%`} note={p.quizzes.grade ? `Grade ${p.quizzes.grade}` : undefined} />
            <Stat label="Work handed in" value={`${p.work.handedIn} of ${p.work.set}`} note={p.work.handedIn > 0 ? `${p.work.onTime} on time` : undefined} />
          </div>

          {p.subjects.length > 0 && (
            <Card className="grid gap-3 p-5">
              <h2 className="text-lg font-semibold">By subject</h2>
              <ul className="grid gap-3">
                {p.subjects.map((s) => (
                  <li key={s.subject} className="grid grid-cols-[minmax(6rem,10rem)_1fr_auto] items-center gap-3">
                    <span className="font-medium">{s.subject}</span>
                    <span className="h-3 overflow-hidden rounded-full bg-secondary" role="img" aria-label={`${s.average} percent`}>
                      <span className="block h-full rounded-full bg-primary" style={{ width: `${s.average}%` }} />
                    </span>
                    <span className="tabular-nums">{s.average}% <span className="text-sm text-muted-foreground">· {s.attempts} {s.attempts === 1 ? 'quiz' : 'quizzes'}</span></span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {p.work.marked > 0 && (
            <Card className="p-5"><p className="text-lg"><b>Marked work:</b> {p.work.marksPercent}% of the marks on {p.work.marked} {p.work.marked === 1 ? 'piece' : 'pieces'} of work.</p></Card>
          )}

          {p.recent.length > 0 && (
            <Card className="grid gap-2 p-5">
              <h2 className="text-lg font-semibold">Latest quizzes</h2>
              <ul className="grid gap-1.5">
                {p.recent.map((a) => (
                  <li key={a.runId} className="flex flex-wrap items-baseline gap-2">
                    <span className="min-w-40 flex-1">{a.quizTitle} <span className="text-sm text-muted-foreground">{[a.subject, day(a.at)].filter(Boolean).join(' · ')}</span></span>
                    <span className="font-semibold tabular-nums">{a.score} / {a.totalMarks}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <Card className="grid gap-1 p-5">
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
      <span className="text-3xl font-semibold tabular-nums">{value}</span>
      {note && <span className="text-sm text-muted-foreground">{note}</span>}
    </Card>
  );
}
