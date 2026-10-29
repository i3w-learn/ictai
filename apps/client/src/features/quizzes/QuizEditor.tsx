import { useEffect, useState } from 'react';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import type { SchoolClass } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, ErrorNote, Field, Panel, Select, useAction } from '../../ui/ui';

interface Draft {
  text: string;
  options: string[];
  correct: number | null;
  marks: number;
}

const blank = (): Draft => ({ text: '', options: ['', '', '', ''], correct: null, marks: 1 });

// Write or change a quiz by hand (v2's ManualQuizDialog). Single-choice questions, 2–6 options.
export function QuizEditor({ quizId, onDone }: { quizId: string | null; onDone: () => void }) {
  const { call } = useApp();
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [meta, setMeta] = useState({ title: '', classId: '', subject: '', topic: '', minutes: '5' });
  const [questions, setQuestions] = useState<Draft[]>([blank()]);

  const load = useAction(async () => {
    setClasses(await call('GET /api/v1/classes'));
    if (!quizId) return;
    const q = await call('GET /api/v1/quizzes/:id', { params: { id: quizId } });
    setMeta({ title: q.title, classId: q.classId, subject: q.subject ?? '', topic: q.topic ?? '', minutes: String(q.secondsPerQuestion / 60) });
    setQuestions(q.questions.map((x) => ({ ...x })));
  });
  useEffect(() => { void load.run(); }, [quizId]);

  const update = (i: number, d: Partial<Draft>) => setQuestions(questions.map((q, j) => (j === i ? { ...q, ...d } : q)));
  const seconds = Math.round(Number(meta.minutes) * 60);

  // Empty option boxes are left out; the correct answer must be one that is filled in.
  const cleaned = questions.map((q) => {
    const kept = q.options.map((o, i) => ({ o: o.trim(), i })).filter((x) => x.o);
    return { text: q.text.trim(), options: kept.map((x) => x.o), correct: kept.findIndex((x) => x.i === q.correct), marks: q.marks };
  });
  const problem =
    !meta.title.trim() ? 'Give the quiz a title.'
    : !meta.classId ? 'Pick a class.'
    : !(seconds >= 10 && seconds <= 600) ? 'Time per question must be between 10 seconds and 10 minutes.'
    : cleaned.findIndex((q) => !q.text || q.options.length < 2 || q.correct < 0) >= 0
      ? `Question ${cleaned.findIndex((q) => !q.text || q.options.length < 2 || q.correct < 0) + 1} needs text, at least 2 options and a correct answer.`
      : null;

  const save = useAction(async () => {
    const body = {
      title: meta.title, classId: meta.classId, subject: meta.subject.trim() || null, topic: meta.topic.trim() || null,
      secondsPerQuestion: seconds, questions: cleaned,
    };
    if (quizId) await call('PUT /api/v1/quizzes/:id', { params: { id: quizId }, body });
    else await call('POST /api/v1/quizzes', { body });
    onDone();
  });

  return (
    <div className="mx-auto grid max-w-4xl gap-6">
      <div className="flex items-center gap-3">
        <Button variant="quiet" onClick={onDone}><ArrowLeft className="size-4" /> Back</Button>
        <h1 className="font-display text-2xl font-semibold">{quizId ? 'Edit quiz' : 'New quiz'}</h1>
      </div>

      <Panel title="About this quiz">
        <div className="flex flex-wrap items-end gap-3">
          <Field id="quiz-title" className="w-72" label="Title" placeholder="Science weekly test" value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} />
          <label className="grid gap-1.5">
            <span className="text-[13px] font-medium text-muted-foreground">Class</span>
            <Select aria-label="Class" value={meta.classId} onChange={(e) => setMeta({ ...meta, classId: e.target.value })}>
              <option value="">Choose a class</option>
              {classes.map((c) => <option key={c.id} value={c.id}>Class {c.name}</option>)}
            </Select>
          </label>
          <Field id="quiz-subject" className="w-44" label="Subject" value={meta.subject} onChange={(e) => setMeta({ ...meta, subject: e.target.value })} />
          <Field id="quiz-topic" className="w-56" label="Topic" value={meta.topic} onChange={(e) => setMeta({ ...meta, topic: e.target.value })} />
          <Field id="quiz-minutes" className="w-40" label="Minutes per question" inputMode="decimal" value={meta.minutes} onChange={(e) => setMeta({ ...meta, minutes: e.target.value })} />
        </div>
      </Panel>

      {questions.map((q, i) => (
        <Panel
          key={i}
          title={`Question ${i + 1}`}
          actions={questions.length > 1 && (
            <Button variant="quiet" aria-label={`Remove question ${i + 1}`} onClick={() => setQuestions(questions.filter((_, j) => j !== i))}>
              <Trash2 className="size-4" />
            </Button>
          )}
        >
          <Field id={`q-${i}-text`} label="Question" value={q.text} onChange={(e) => update(i, { text: e.target.value })} />
          <div className="grid gap-2 sm:grid-cols-2">
            {q.options.map((o, oi) => (
              <div key={oi} className="flex items-center gap-2">
                <input
                  type="radio" name={`q-${i}-correct`} aria-label={`Option ${oi + 1} is correct`}
                  className="size-4 accent-[var(--primary)]" checked={q.correct === oi}
                  onChange={() => update(i, { correct: oi })}
                />
                <input
                  aria-label={`Option ${oi + 1}`} placeholder={`Option ${oi + 1}`}
                  className="h-11 w-full rounded-xl border border-border bg-card px-3 text-[15px]"
                  value={o} onChange={(e) => update(i, { options: q.options.map((x, k) => (k === oi ? e.target.value : x)) })}
                />
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span>Tick the right answer.</span>
            {q.options.length < 6 && <Button variant="quiet" onClick={() => update(i, { options: [...q.options, ''] })}>Add option</Button>}
            <span className="flex-1" />
            <label className="flex items-center gap-2">
              Marks
              <Select aria-label="Marks" className="min-w-20" value={q.marks} onChange={(e) => update(i, { marks: Number(e.target.value) })}>
                {Array.from({ length: 10 }, (_, n) => <option key={n + 1} value={n + 1}>{n + 1}</option>)}
              </Select>
            </label>
          </div>
        </Panel>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="quiet" disabled={questions.length >= 100} onClick={() => setQuestions([...questions, blank()])}><Plus className="size-4" /> Add question</Button>
        <span className="flex-1 text-sm text-muted-foreground">{problem}</span>
        <Button disabled={!!problem || save.busy} onClick={() => save.run()}>Save quiz</Button>
      </div>
      <ErrorNote message={load.error ?? save.error} />
    </div>
  );
}
