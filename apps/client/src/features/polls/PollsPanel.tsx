import { useEffect, useState } from 'react';
import { MessageCircleQuestion, Plus, Star, X } from 'lucide-react';
import { pollRoom, type Poll, type SchoolClass } from '@ict/contracts';
import { useApp, useRelayRoom } from '../../app/app-context';
import { Button, ConfirmButton, ErrorNote, Field, Panel, Select, controlClass, useAction } from '../../ui/ui';
import { useLang, useT, type T } from '../../i18n/i18n';

const whenShort = (at: number, locale: string | undefined) => new Date(at).toLocaleString(locale, { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });

// One poll with how the class answered: a bar for each option, or for each number of stars.
export function PollResult({ poll }: { poll: Poll }) {
  const t = useT();
  const most = Math.max(1, ...poll.counts);
  const labels = poll.kind === 'rating' ? poll.counts.map((_, i) => (i === 0 ? t('{n} star', { n: i + 1 }) : t('{n} stars', { n: i + 1 }))) : poll.options;
  // The sentence is translated whole; the number in the middle is shown in bold.
  const [averageBefore, averageAfter] = t('average {average} of 5').split('{average}');
  return (
    <div className="grid gap-1.5">
      {labels.map((label, i) => (
        <div key={i} className="grid grid-cols-[minmax(6rem,14rem)_1fr_2.5rem] items-center gap-3 text-sm">
          <span className="truncate" title={label}>{label}</span>
          <span className="h-3 rounded-full bg-secondary"><span className="block h-3 rounded-full bg-primary transition-[width]" style={{ width: `${(poll.counts[i]! / most) * 100}%` }} /></span>
          <span className="text-right font-semibold tabular-nums">{poll.counts[i]}</span>
        </div>
      ))}
      <p className="mt-1 text-sm text-muted-foreground">
        {poll.answered === 0 ? t('No answers yet.') : poll.answered === 1 ? t('{n} answer', { n: poll.answered }) : t('{n} answers', { n: poll.answered })}
        {poll.average != null && <> · {averageBefore}<b className="text-foreground">{poll.average}</b>{averageAfter}</>}
      </p>
    </div>
  );
}

// A new poll starts with Yes and No, in the language of the screen.
const blank = (t: T) => ({ question: '', kind: 'choice' as Poll['kind'], options: [t('Yes'), t('No')] });

// Spec 4.3 "Polls": ask a class one quick question and watch the answers come in. Nothing is scored
// and no names are shown.
export function PollsPanel({ refresh }: { refresh: number }) {
  const { call } = useApp();
  const { t, locale } = useLang();
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [classId, setClassId] = useState('');
  const [polls, setPolls] = useState<Poll[]>([]);
  const [form, setForm] = useState(() => blank(t));

  const load = useAction(async () => {
    const cls = await call('GET /api/v1/classes');
    setClasses(cls);
    const id = cls.some((c) => c.id === classId) ? classId : (cls[0]?.id ?? '');
    if (id !== classId) setClassId(id);
    setPolls(id ? await call('GET /api/v1/polls', { query: { classId: id } }) : []);
  });
  const { run: loadNow } = load;
  useEffect(() => { void loadNow(); }, [loadNow, classId, refresh]);

  // The server pushes the class's newest poll whenever a student answers: put it into the list.
  const live = useRelayRoom<Poll | null>(classId ? pollRoom(classId) : null).state;
  const [pushed, setPushed] = useState(live);
  if (live !== pushed) {
    setPushed(live);
    if (live && live.classId === classId) setPolls((list) => (list.some((p) => p.id === live.id) ? list.map((p) => (p.id === live.id ? live : p)) : [live, ...list.map((p) => ({ ...p, open: false }))]));
  }

  const options = form.options.map((o) => o.trim());
  const problem = !classId ? t('Add a class first.') : !form.question.trim() ? t('Type the question.') : form.kind === 'choice' && options.some((o) => !o) ? t('Fill in every option, or remove the empty one.') : null;

  const ask = useAction(async () => {
    await call('POST /api/v1/polls', { body: { classId, question: form.question, kind: form.kind, options: form.kind === 'choice' ? options : [] } });
    setForm(blank(t));
    await load.run();
  });
  const close = useAction(async (id: string) => {
    await call('POST /api/v1/polls/:id/close', { params: { id } });
    await load.run();
  });
  const remove = useAction(async (id: string) => {
    await call('DELETE /api/v1/polls/:id', { params: { id } });
    await load.run();
  });
  const setOption = (i: number, text: string) => setForm({ ...form, options: form.options.map((o, j) => (j === i ? text : o)) });

  return (
    <Panel title={t('Polls')}>
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (!problem) void ask.run(); }}>
        <div className="flex flex-wrap items-end gap-3">
          <label className="grid gap-1.5">
            <span className="text-[0.8125rem] font-medium text-muted-foreground">{t('Class')}</span>
            <Select aria-label={t('Poll class')} value={classId} onChange={(e) => setClassId(e.target.value)}>
              {classes.length === 0 && <option value="">{t('No classes yet')}</option>}
              {classes.map((c) => <option key={c.id} value={c.id}>{t('Class {name}', { name: c.name })}</option>)}
            </Select>
          </label>
          <Field id="poll-question" className="min-w-72 flex-1" label={t('Question')} placeholder={t("Was today's lesson easy to follow?")} maxLength={300} value={form.question} onChange={(e) => setForm({ ...form, question: e.target.value })} />
          <label className="grid gap-1.5">
            <span className="text-[0.8125rem] font-medium text-muted-foreground">{t('Students answer with')}</span>
            <Select aria-label={t('Kind of poll')} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as Poll['kind'] })}>
              <option value="choice">{t('One of my options')}</option>
              <option value="rating">{t('1 to 5 stars')}</option>
            </Select>
          </label>
        </div>
        {form.kind === 'choice' && (
          <div className="flex flex-wrap items-center gap-2">
            {form.options.map((o, i) => (
              <span key={i} className="flex items-center gap-1">
                <input aria-label={t('Option {n}', { n: i + 1 })} className={`${controlClass} w-44`} maxLength={120} placeholder={t('Option {n}', { n: i + 1 })} value={o} onChange={(e) => setOption(i, e.target.value)} />
                {form.options.length > 2 && <button type="button" aria-label={t('Remove option {n}', { n: i + 1 })} className="grid size-9 cursor-pointer place-items-center rounded-full text-muted-foreground hover:bg-secondary" onClick={() => setForm({ ...form, options: form.options.filter((_, j) => j !== i) })}><X className="size-4" /></button>}
              </span>
            ))}
            {form.options.length < 6 && <Button type="button" variant="quiet" onClick={() => setForm({ ...form, options: [...form.options, ''] })}><Plus className="size-4" /> {t('Option')}</Button>}
          </div>
        )}
        <div className="flex flex-wrap items-center gap-4">
          <Button type="submit" disabled={!!problem || ask.busy}><MessageCircleQuestion className="size-4" /> {t('Ask the class')}</Button>
          <span className="text-sm text-muted-foreground">{problem ?? t('It opens on every student screen of the class. Nothing is scored and you see no names.')}</span>
        </div>
        <ErrorNote message={ask.error} />
      </form>

      {polls.length === 0 ? (
        <p className="rounded-3xl border border-dashed border-border p-8 text-center text-muted-foreground">{t('No polls for this class yet.')}</p>
      ) : (
        <ul className="grid gap-3">
          {polls.map((p) => (
            <li key={p.id} className="grid gap-3 rounded-2xl border border-border p-4">
              <div className="flex flex-wrap items-start gap-3">
                <span className="min-w-56 flex-1">
                  <span className="font-medium">{p.question}</span>
                  {p.open
                    ? <span className="ml-2 inline-flex items-center gap-1.5 rounded-full bg-success/15 px-2 py-0.5 text-xs font-semibold text-success"><span className="size-2 animate-pulse rounded-full bg-success" /> {t('Open on student screens')}</span>
                    : <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-muted-foreground">{t('Closed')}</span>}
                  <span className="mt-0.5 block text-xs text-muted-foreground">{p.kind === 'rating' && <Star className="mr-1 inline size-3" />}{`${t('by {name}', { name: p.byName })} · ${whenShort(p.createdAt, locale)}`}</span>
                </span>
                {p.open && <Button disabled={close.busy} onClick={() => close.run(p.id)}>{t('Close poll')}</Button>}
                <ConfirmButton question={t('Delete this poll and its answers?')} onConfirm={() => void remove.run(p.id)}>{t('Delete')}</ConfirmButton>
              </div>
              <PollResult poll={p} />
            </li>
          ))}
        </ul>
      )}
      <ErrorNote message={load.error ?? close.error ?? remove.error} />
    </Panel>
  );
}
