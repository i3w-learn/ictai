import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { ANSWER_MAX, type MyWork as Work } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, Card, ErrorNote, PageTitle, TextArea, cn, useAction } from '../../ui/ui';
import { useLang } from '../../i18n/i18n';
import { dayShort, sortWork, STATUS_WORDS } from './work';

const TAG = { todo: 'bg-primary/10 text-primary', submitted: 'bg-secondary text-secondary-foreground', marked: 'bg-success/10 text-success' } as const;

// PRD student app "My work": what the teacher has set, in the order to look at it. Open one to read
// what to do and write the answer. After marking, the marks and the teacher's comment show here.
export function MyWork() {
  const { call } = useApp();
  const { t, locale } = useLang();
  const [work, setWork] = useState<Work[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const load = useAction(async () => { setWork(await call('GET /api/v1/work')); setLoaded(true); });
  const { run: loadNow } = load;
  useEffect(() => { void loadNow(); }, [loadNow]);

  const open = work.find((w) => w.id === openId);
  if (open) return <OneWork work={open} onBack={() => setOpenId(null)} onChanged={(w) => setWork((list) => list.map((x) => (x.id === w.id ? w : x)))} />;

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-5">
      <PageTitle sub={t('Work your teacher has set for you.')}>{t('My work')}</PageTitle>
      {loaded && work.length === 0 && <p className="rounded-3xl border border-dashed border-border p-10 text-center text-muted-foreground">{t('Nothing to do right now. New work from your teacher will show here.')}</p>}
      <ul className="grid gap-3">
        {sortWork(work).map((w) => (
          <li key={w.id}>
            <button type="button" onClick={() => setOpenId(w.id)} className="flex w-full cursor-pointer flex-wrap items-center gap-3 rounded-2xl border border-border bg-card px-4 py-4 text-left shadow-sm hover:border-accent/50">
              <span className="min-w-48 flex-1">
                <span className="block text-lg font-semibold">{w.title}</span>
                <span className="text-sm text-muted-foreground">{[w.subject, w.byName, w.dueAt ? t('due {day}', { day: dayShort(w.dueAt, locale) }) : null].filter(Boolean).join(' · ')}</span>
              </span>
              {w.overdue && <span className="rounded-full bg-destructive/10 px-3 py-1 text-sm font-semibold text-destructive">{t('Late: do this first')}</span>}
              {w.mark && <span className="text-lg font-semibold tabular-nums">{w.mark.marks} / {w.maxMarks}</span>}
              <span className={cn('rounded-full px-3 py-1 text-sm font-semibold', TAG[w.status])}>{t(STATUS_WORDS[w.status])}</span>
            </button>
          </li>
        ))}
      </ul>
      <ErrorNote message={load.error} />
    </div>
  );
}

function OneWork({ work: w, onBack, onChanged }: { work: Work; onBack: () => void; onChanged: (w: Work) => void }) {
  const { call } = useApp();
  const { t, locale } = useLang();
  // Starts from the last answer, so handing in again means improving it, not starting over.
  const [body, setBody] = useState(w.answer?.body ?? '');
  const [done, setDone] = useState(false);
  const send = useAction(async () => {
    onChanged(await call('POST /api/v1/work/:id/answers', { params: { id: w.id }, body: { body } }));
    setDone(true);
  });
  const same = w.answer?.body === body.trim();

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-5">
      <div><Button variant="quiet" onClick={onBack}><ArrowLeft className="size-4" /> {t('My work')}</Button></div>
      <PageTitle eyebrow={[w.subject, w.byName, w.dueAt ? t('Due {day}', { day: dayShort(w.dueAt, locale) }) : null, t('Out of {marks}', { marks: w.maxMarks })].filter(Boolean).join(' · ')}>{w.title}</PageTitle>
      {w.instructions && <Card className="p-5"><p className="text-lg whitespace-pre-wrap">{w.instructions}</p></Card>}

      {w.mark ? (
        <Card className="grid gap-3 p-5">
          <p className="text-2xl font-semibold tabular-nums">{t('You got {marks} out of {max}', { marks: w.mark.marks, max: w.maxMarks })}</p>
          {w.mark.comment && <p className="rounded-lg bg-secondary px-3 py-2"><b>{t('Your teacher says:')}</b> {w.mark.comment}</p>}
          <p className="text-sm font-medium text-muted-foreground">{t('Your answer')}</p>
          <p className="whitespace-pre-wrap">{w.answer?.body}</p>
        </Card>
      ) : (
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (body.trim() && !same) void send.run(); }}>
          <TextArea id="work-answer" label={t('Your answer')} rows={10} maxLength={ANSWER_MAX} placeholder={t('Write your answer here.')} className="text-lg" value={body} onChange={(e) => { setBody(e.target.value); setDone(false); }} />
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" className="h-12 px-6" disabled={!body.trim() || same || send.busy}>{w.answer ? t('Hand in again') : t('Hand in')}</Button>
            {w.answer && same && <span className="text-success">{done ? t('Handed in.') : ''} {w.answer.late ? t('Your teacher has your answer (it was late).') : t('Your teacher has your answer.')} {t('You can still change it until it is marked.')}</span>}
            {w.overdue && <span className="text-destructive">{t('This was due {day}. Hand it in as soon as you can.', { day: dayShort(w.dueAt!, locale) })}</span>}
          </div>
          <ErrorNote message={send.error} />
        </form>
      )}
    </div>
  );
}
