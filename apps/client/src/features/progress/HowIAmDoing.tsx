import { useEffect, useState } from 'react';
import { Lightbulb } from 'lucide-react';
import type { MyProgress } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, Card, ErrorNote, PageTitle, useAction } from '../../ui/ui';
import { useLang } from '../../i18n/i18n';

const day = (at: number, locale: string | undefined) => new Date(at).toLocaleDateString(locale, { day: 'numeric', month: 'short' });

// PRD student app "How I am doing": the student's own quiz results and work, and one thing to try next.
// A student only ever sees their own numbers here.
export function HowIAmDoing({ onWork }: { onWork: () => void }) {
  const { call } = useApp();
  const { t, locale } = useLang();
  const [p, setP] = useState<MyProgress | null>(null);
  const load = useAction(async () => setP(await call('GET /api/v1/me/progress')));
  const { run: loadNow } = load;
  useEffect(() => { void loadNow(); }, [loadNow]);

  const nothingYet = p && p.quizzes.taken === 0 && p.work.set === 0;
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-5">
      <PageTitle sub={t('Only you can see this.')}>{t('How I am doing')}</PageTitle>
      <ErrorNote message={load.error} />
      {nothingYet && <p className="rounded-3xl border border-dashed border-border p-10 text-center text-muted-foreground">{t('Nothing to show yet. After your first quiz or piece of work, your results will be here.')}</p>}

      {p && !nothingYet && (
        <>
          {p.tryNext && (
            <Card className="flex flex-wrap items-center gap-3 border-primary/30 bg-primary/5 p-5">
              <Lightbulb className="size-6 shrink-0 text-primary" />
              <p className="min-w-48 flex-1 text-lg">
                <b>{t('Try this next:')} </b>
                {p.tryNext.kind === 'work'
                  ? t('hand in {title}. It is past its date.', { title: p.tryNext.title })
                  : t('practise {subject}. Your quiz average there is {average}%.', { subject: p.tryNext.subject, average: p.tryNext.average })}
              </p>
              {p.tryNext.kind === 'work' && <Button onClick={onWork}>{t('Open my work')}</Button>}
            </Card>
          )}

          <div className="grid gap-3 sm:grid-cols-3">
            <Stat label={t('Quizzes taken')} value={String(p.quizzes.taken)} />
            <Stat label={t('Quiz average')} value={p.quizzes.average === null ? '–' : `${p.quizzes.average}%`} note={p.quizzes.grade ? t('Grade {grade}', { grade: p.quizzes.grade }) : undefined} />
            <Stat label={t('Work handed in')} value={t('{n} of {total}', { n: p.work.handedIn, total: p.work.set })} note={p.work.handedIn > 0 ? t('{n} on time', { n: p.work.onTime }) : undefined} />
          </div>

          {p.subjects.length > 0 && (
            <Card className="grid gap-3 p-5">
              <h2 className="text-lg font-semibold">{t('By subject')}</h2>
              <ul className="grid gap-3">
                {p.subjects.map((s) => (
                  <li key={s.subject} className="grid grid-cols-[minmax(6rem,10rem)_1fr_auto] items-center gap-3">
                    <span className="font-medium">{s.subject}</span>
                    <span className="h-3 overflow-hidden rounded-full bg-secondary" role="img" aria-label={t('{n} percent', { n: s.average })}>
                      <span className="block h-full rounded-full bg-primary" style={{ width: `${s.average}%` }} />
                    </span>
                    <span className="tabular-nums">{s.average}% <span className="text-sm text-muted-foreground">· {s.attempts === 1 ? t('{n} quiz', { n: s.attempts }) : t('{n} quizzes', { n: s.attempts })}</span></span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {p.work.marked > 0 && (
            <Card className="p-5"><p className="text-lg"><b>{t('Marked work:')}</b> {p.work.marked === 1 ? t('{percent}% of the marks on {n} piece of work.', { percent: p.work.marksPercent ?? '', n: p.work.marked }) : t('{percent}% of the marks on {n} pieces of work.', { percent: p.work.marksPercent ?? '', n: p.work.marked })}</p></Card>
          )}

          {p.recent.length > 0 && (
            <Card className="grid gap-2 p-5">
              <h2 className="text-lg font-semibold">{t('Latest quizzes')}</h2>
              <ul className="grid gap-1.5">
                {p.recent.map((a) => (
                  <li key={a.runId} className="flex flex-wrap items-baseline gap-2">
                    <span className="min-w-40 flex-1">{a.quizTitle} <span className="text-sm text-muted-foreground">{[a.subject, day(a.at, locale)].filter(Boolean).join(' · ')}</span></span>
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
