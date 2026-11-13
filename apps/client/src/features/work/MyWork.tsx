import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import { ANSWER_MAX, type MyWork as Work } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, Card, ErrorNote, PageTitle, cn, useAction } from '../../ui/ui';
import { dayShort, sortWork, STATUS_WORDS } from './work';

const TAG = { todo: 'bg-primary/10 text-primary', submitted: 'bg-secondary text-secondary-foreground', marked: 'bg-success/10 text-success' } as const;

// PRD student app "My work": what the teacher has set, in the order to look at it. Open one to read
// what to do and write the answer. After marking, the marks and the teacher's comment show here.
export function MyWork({ onBack }: { onBack: () => void }) {
  const { call } = useApp();
  const [work, setWork] = useState<Work[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const load = useAction(async () => { setWork(await call('GET /api/v1/work')); setLoaded(true); });
  useEffect(() => { void load.run(); }, []);

  const open = work.find((w) => w.id === openId);
  if (open) return <OneWork work={open} onBack={() => setOpenId(null)} onChanged={(w) => setWork((list) => list.map((x) => (x.id === w.id ? w : x)))} />;

  return (
    <div className="mx-auto grid w-full max-w-3xl gap-5">
      <div><Button variant="quiet" onClick={onBack}><ArrowLeft className="size-4" /> Back</Button></div>
      <PageTitle sub="Work your teacher has set for you.">My work</PageTitle>
      {loaded && work.length === 0 && <p className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">Nothing to do right now. New work from your teacher will show here.</p>}
      <ul className="grid gap-3">
        {sortWork(work).map((w) => (
          <li key={w.id}>
            <button type="button" onClick={() => setOpenId(w.id)} className="flex w-full cursor-pointer flex-wrap items-center gap-3 rounded-2xl border border-border bg-card px-4 py-4 text-left shadow-sm hover:border-accent/50">
              <span className="min-w-48 flex-1">
                <span className="block text-lg font-semibold">{w.title}</span>
                <span className="text-sm text-muted-foreground">{[w.subject, w.byName, w.dueAt ? `due ${dayShort(w.dueAt)}` : null].filter(Boolean).join(' · ')}</span>
              </span>
              {w.overdue && <span className="rounded-full bg-destructive/10 px-3 py-1 text-sm font-semibold text-destructive">Late: do this first</span>}
              {w.mark && <span className="text-lg font-semibold tabular-nums">{w.mark.marks} / {w.maxMarks}</span>}
              <span className={cn('rounded-full px-3 py-1 text-sm font-semibold', TAG[w.status])}>{STATUS_WORDS[w.status]}</span>
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
      <div><Button variant="quiet" onClick={onBack}><ArrowLeft className="size-4" /> My work</Button></div>
      <PageTitle eyebrow={[w.subject, w.byName, w.dueAt ? `Due ${dayShort(w.dueAt)}` : null, `Out of ${w.maxMarks}`].filter(Boolean).join(' · ')}>{w.title}</PageTitle>
      {w.instructions && <Card className="p-5"><p className="text-lg whitespace-pre-wrap">{w.instructions}</p></Card>}

      {w.mark ? (
        <Card className="grid gap-3 p-5">
          <p className="text-2xl font-semibold tabular-nums">You got {w.mark.marks} out of {w.maxMarks}</p>
          {w.mark.comment && <p className="rounded-lg bg-secondary px-3 py-2"><b>Your teacher says:</b> {w.mark.comment}</p>}
          <p className="text-sm font-medium text-muted-foreground">Your answer</p>
          <p className="whitespace-pre-wrap">{w.answer?.body}</p>
        </Card>
      ) : (
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (body.trim() && !same) void send.run(); }}>
          <label className="grid gap-1.5" htmlFor="work-answer">
            <span className="text-[13px] font-medium text-muted-foreground">Your answer</span>
            <textarea
              id="work-answer" rows={10} maxLength={ANSWER_MAX} placeholder="Write your answer here."
              className="w-full resize-y rounded-xl border border-border bg-card px-3 py-2.5 text-lg leading-relaxed text-foreground placeholder:text-muted-foreground/60"
              value={body} onChange={(e) => { setBody(e.target.value); setDone(false); }}
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" className="h-12 px-6" disabled={!body.trim() || same || send.busy}>{w.answer ? 'Hand in again' : 'Hand in'}</Button>
            {w.answer && same && <span className="text-success">{done ? 'Handed in. ' : ''}Your teacher has your answer{w.answer.late ? ' (it was late)' : ''}. You can still change it until it is marked.</span>}
            {w.overdue && <span className="text-destructive">This was due {dayShort(w.dueAt!)}. Hand it in as soon as you can.</span>}
          </div>
          <ErrorNote message={send.error} />
        </form>
      )}
    </div>
  );
}
