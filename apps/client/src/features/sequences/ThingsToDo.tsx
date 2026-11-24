import { useEffect, useState } from 'react';
import { Check, Circle } from 'lucide-react';
import type { ContentItem, Todo, TodoStep } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Card, ErrorNote, PageTitle, cn, useAction } from '../../ui/ui';
import { useT } from '../../i18n/i18n';
import { Viewer } from '../content/Viewer';

// PRD student app "Things to do": the playlists and learning paths for the student's class, each step
// with a tick, and the next step picked out. Opening a library step ticks it. A work step is ticked
// when the work is handed in under My work.
export function ThingsToDo({ onWork }: { onWork: () => void }) {
  const { call } = useApp();
  const t = useT();
  const [todo, setTodo] = useState<Todo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState<ContentItem | null>(null);
  const load = useAction(async () => { setTodo(await call('GET /api/v1/todo')); setLoaded(true); });
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

  if (open) return <Viewer item={open} onBack={() => setOpen(null)} />;
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-5">
      <PageTitle sub={t('Go through the steps in order. A tick shows what you have done.')}>{t('Things to do')}</PageTitle>
      {loaded && todo.length === 0 && <p className="rounded-3xl border border-dashed border-border p-10 text-center text-muted-foreground">{t("Nothing to do right now. Your teacher's playlists and learning paths will show here.")}</p>}
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
      <ErrorNote message={load.error ?? start.error} />
    </div>
  );
}
