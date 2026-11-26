import { useEffect, useState } from 'react';
import { Check, Circle } from 'lucide-react';
import type { ContentItem, PracticeForStudent, StudentRunState, Todo, TodoStep } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, Card, ErrorNote, PageTitle, cn, useAction } from '../../ui/ui';
import { useT } from '../../i18n/i18n';
import { Viewer } from '../content/Viewer';

// PRD student app "Things to do": the playlists and learning paths for the student's class, each step
// with a tick, and the next step picked out. Opening a library step ticks it. A work step is ticked
// when the work is handed in under My work.
// Practice quizzes the teacher gave the class are listed first: no clock, as many tries as they like.
export function ThingsToDo({ onWork, onPlay }: { onWork: () => void; onPlay: (run: StudentRunState) => void }) {
  const { call } = useApp();
  const t = useT();
  const [todo, setTodo] = useState<Todo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState<ContentItem | null>(null);
  const [practice, setPractice] = useState<PracticeForStudent[]>([]);
  const load = useAction(async () => {
    const [todo, practice] = await Promise.all([
      call('GET /api/v1/todo'),
      // Practice is an extra: if it cannot be read, the playlists still show.
      call('GET /api/v1/quiz-runs/practice').catch(() => [] as PracticeForStudent[]),
    ]);
    setTodo(todo);
    setPractice(practice);
    setLoaded(true);
  });
  const { run: loadNow } = load;
  useEffect(() => { void loadNow(); }, [loadNow]);

  const start = useAction(async (step: TodoStep) => {
    if (step.kind === 'work') return onWork();
    if (!step.content) return;
    setOpen(step.content);
    if (!step.done) {
      await call('POST /api/v1/todo/steps/:id/done', { params: { id: step.id } });
      await load.run();
    }
  });

  // Opens the practice quiz where the student left it; after a finished try, starts the next one.
  const play = useAction(async (p: PracticeForStudent) => {
    const run = await call('POST /api/v1/quiz-runs/:id/join', { params: { id: p.runId } });
    onPlay(run.finished ? await call('POST /api/v1/quiz-runs/:id/retry', { params: { id: p.runId } }) : run);
  });

  if (open) return <Viewer item={open} onBack={() => setOpen(null)} />;
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-5">
      <PageTitle sub={t('Go through the steps in order. A tick shows what you have done.')}>{t('Things to do')}</PageTitle>
      {practice.length > 0 && (
        <Card className="grid gap-3 p-5">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="min-w-48 flex-1 text-xl font-semibold">{t('Practice quizzes')}</h2>
            <span className="text-sm text-muted-foreground">{t('No clock. Try as many times as you like.')}</span>
          </div>
          <ul className="grid gap-2">
            {practice.map((p) => (
              <li key={p.runId} className="flex flex-wrap items-center gap-3 rounded-xl border border-border bg-card px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-lg font-semibold">{p.title}</span>
                  <span className="text-sm text-muted-foreground">
                    {p.best == null ? t('{n} questions', { n: p.questionCount }) : `${t('Best so far: {best} out of {total}', { best: p.best, total: p.totalMarks })} · ${t('Tries: {n}', { n: p.tries })}`}
                  </span>
                </span>
                <Button disabled={play.busy} onClick={() => play.run(p)}>{p.tries === 0 ? t('Start') : p.finished ? t('Try again') : t('Continue')}</Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {loaded && todo.length === 0 && practice.length === 0 && <p className="rounded-3xl border border-dashed border-border p-10 text-center text-muted-foreground">{t("Nothing to do right now. Your teacher's playlists and learning paths will show here.")}</p>}
      {todo.map((q) => (
        <Card key={q.id} className="grid gap-3 p-5">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="min-w-48 flex-1 text-xl font-semibold">{q.title}</h2>
            <span className="text-sm text-muted-foreground">{[q.subject, q.byName].filter(Boolean).join(' · ')}</span>
            <span className={cn('rounded-full px-3 py-1 text-sm font-semibold tabular-nums', q.doneSteps === q.steps.length ? 'bg-success/10 text-success' : 'bg-secondary text-secondary-foreground')}>
              {q.doneSteps === q.steps.length ? t('All done') : t('{done} of {total} done', { done: q.doneSteps, total: q.steps.length })}
            </span>
          </div>
          <ol className="grid gap-2">
            {q.steps.map((s, i) => {
              const next = s.id === q.nextStepId;
              return (
                <li key={s.id}>
                  <button
                    type="button" disabled={!s.available || start.busy} onClick={() => void start.run(s)}
                    className={cn('flex w-full cursor-pointer items-center gap-3 rounded-xl border px-4 py-3 text-left disabled:cursor-not-allowed disabled:opacity-60', next ? 'border-primary bg-primary/5' : 'border-border bg-card')}
                  >
                    {s.done ? <Check className="size-6 shrink-0 text-success" aria-label={t('Done')} /> : <Circle className="size-6 shrink-0 text-muted-foreground" aria-label={t('Not done yet')} />}
                    <span className="min-w-0 flex-1">
                      <span className="block text-lg font-semibold">{i + 1}. {s.title}</span>
                      <span className="text-sm text-muted-foreground">{!s.available ? t('No longer here. Skip this step.') : s.kind === 'work' ? t('A piece of work: opens My work') : t('Tap to open')}</span>
                    </span>
                    {next && <span className="rounded-full bg-primary px-3 py-1 text-sm font-semibold text-primary-foreground">{t('Next')}</span>}
                  </button>
                </li>
              );
            })}
          </ol>
        </Card>
      ))}
      <ErrorNote message={load.error ?? start.error ?? play.error} />
    </div>
  );
}
