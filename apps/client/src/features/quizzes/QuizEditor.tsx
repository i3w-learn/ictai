import { useEffect, useState } from 'react';
import { ArrowLeft, Plus, Trash2 } from 'lucide-react';
import type { SchoolClass } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, ErrorNote, Field, Note, Panel, Select, useAction, controlClass } from '../../ui/ui';
import { useT } from '../../i18n/i18n';
import { SubjectField, useMySubjects } from './SubjectField';
import type { AiDraft } from './AiQuizMaker';

interface Draft {
  text: string;
  options: string[];
  correct: number | null;
  marks: number;
}

const blank = (): Draft => ({ text: '', options: ['', '', '', ''], correct: null, marks: 1 });

// Write or change a quiz by hand (v2's ManualQuizDialog). Single-choice questions, 2–6 options.
// With an AI draft, questions the AI was unsure of carry a note until the teacher edits them.
export function QuizEditor({ quizId, draft, onDone }: { quizId: string | null; draft?: AiDraft; onDone: () => void }) {
  const { call } = useApp();
  const t = useT();
  const subjects = useMySubjects();
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [meta, setMeta] = useState({ title: '', classId: '', subject: '', topic: '', minutes: '5' });
  const [questions, setQuestions] = useState<Draft[]>([blank()]);
  const [flags, setFlags] = useState<(string | null)[]>([]);

  const load = useAction(async () => {
    setClasses(await call('GET /api/v1/classes'));
    if (draft) {
      const { request: r, result } = draft;
      setMeta({ title: t('{topic} quiz', { topic: r.topic }), classId: r.classId, subject: r.subject, topic: r.topic, minutes: '1' });
      setQuestions(result.questions.map((x) => ({ ...x })));
      setFlags(result.flags.map((f) => (f.ok ? null : f.note)));
    }
    if (!quizId) return;
    const q = await call('GET /api/v1/quizzes/:id', { params: { id: quizId } });
    setMeta({ title: q.title, classId: q.classId, subject: q.subject ?? '', topic: q.topic ?? '', minutes: String(q.secondsPerQuestion / 60) });
    setQuestions(q.questions.map((x) => ({ ...x })));
  });
  const { run: loadNow } = load;
  useEffect(() => { void loadNow(); }, [loadNow, quizId]);

  // Editing a question counts as checking it, so its AI note goes away.
  const update = (i: number, d: Partial<Draft>) => {
    setQuestions(questions.map((q, j) => (j === i ? { ...q, ...d } : q)));
    setFlags(flags.map((f, j) => (j === i ? null : f)));
  };
  const removeQuestion = (i: number) => {
    setQuestions(questions.filter((_, j) => j !== i));
    setFlags(flags.filter((_, j) => j !== i));
  };
  const seconds = Math.round(Number(meta.minutes) * 60);

  // Empty option boxes are left out; the correct answer must be one that is filled in.
  const cleaned = questions.map((q) => {
    const kept = q.options.map((o, i) => ({ o: o.trim(), i })).filter((x) => x.o);
    return { text: q.text.trim(), options: kept.map((x) => x.o), correct: kept.findIndex((x) => x.i === q.correct), marks: q.marks };
  });
  const problem =
    !meta.title.trim() ? t('Give the quiz a title.')
    : !meta.classId ? t('Pick a class.')
    : subjects && !meta.subject.trim() ? t('Choose the subject.')
    : !(seconds >= 10 && seconds <= 600) ? t('Time per question must be between 10 seconds and 10 minutes.')
    : cleaned.findIndex((q) => !q.text || q.options.length < 2 || q.correct < 0) >= 0
      ? t('Question {n} needs text, at least 2 options and a correct answer.', { n: cleaned.findIndex((q) => !q.text || q.options.length < 2 || q.correct < 0) + 1 })
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
        <Button variant="quiet" onClick={onDone}><ArrowLeft className="size-4" /> {t('Back')}</Button>
        <h1 className="font-display text-2xl font-semibold">{quizId ? t('Edit quiz') : draft ? t('Check the AI quiz') : t('New quiz')}</h1>
      </div>

      {draft && (
        <Note>
          {t('The AI wrote this draft. Read every question before saving.')}
          {flags.filter(Boolean).length === 1 && ` ${t('1 question marked in red needs a closer look.')}`}
          {flags.filter(Boolean).length > 1 && ` ${t('{n} questions marked in red need a closer look.', { n: flags.filter(Boolean).length })}`}
          {draft.result.note && ` ${draft.result.note}`}
        </Note>
      )}

      <Panel title={t('About this quiz')}>
        <div className="flex flex-wrap items-end gap-3">
          <Field id="quiz-title" className="w-72" label={t('Title')} placeholder={t('Science weekly test')} value={meta.title} onChange={(e) => setMeta({ ...meta, title: e.target.value })} />
          <label className="grid gap-1.5">
            <span className="text-[0.8125rem] font-medium text-muted-foreground">{t('Class')}</span>
            <Select aria-label={t('Class')} value={meta.classId} onChange={(e) => setMeta({ ...meta, classId: e.target.value })}>
              <option value="">{t('Choose a class')}</option>
              {classes.map((c) => <option key={c.id} value={c.id}>{t('Class {name}', { name: c.name })}</option>)}
            </Select>
          </label>
          <SubjectField id="quiz-subject" value={meta.subject} onChange={(subject) => setMeta({ ...meta, subject })} />
          <Field id="quiz-topic" className="w-56" label={t('Topic')} value={meta.topic} onChange={(e) => setMeta({ ...meta, topic: e.target.value })} />
          <Field id="quiz-minutes" className="w-40" label={t('Minutes per question')} inputMode="decimal" value={meta.minutes} onChange={(e) => setMeta({ ...meta, minutes: e.target.value })} />
        </div>
      </Panel>

      {questions.map((q, i) => (
        <Panel
          key={i}
          title={t('Question {n}', { n: i + 1 })}
          actions={questions.length > 1 && (
            <Button variant="quiet" aria-label={t('Remove question {n}', { n: i + 1 })} onClick={() => removeQuestion(i)}>
              <Trash2 className="size-4" />
            </Button>
          )}
        >
          {flags[i] && <p className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{flags[i]}</p>}
          <Field id={`q-${i}-text`} label={t('Question')} value={q.text} onChange={(e) => update(i, { text: e.target.value })} />
          <div className="grid gap-2 sm:grid-cols-2">
            {q.options.map((o, oi) => (
              <div key={oi} className="flex items-center gap-2">
                <input
                  type="radio" name={`q-${i}-correct`} aria-label={t('Option {n} is correct', { n: oi + 1 })}
                  className="size-4 accent-[var(--primary)]" checked={q.correct === oi}
                  onChange={() => update(i, { correct: oi })}
                />
                <input
                  aria-label={t('Option {n}', { n: oi + 1 })} placeholder={t('Option {n}', { n: oi + 1 })}
                  className={controlClass}
                  value={o} onChange={(e) => update(i, { options: q.options.map((x, k) => (k === oi ? e.target.value : x)) })}
                />
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
            <span>{t('Tick the right answer.')}</span>
            {q.options.length < 6 && <Button variant="quiet" onClick={() => update(i, { options: [...q.options, ''] })}>{t('Add option')}</Button>}
            <span className="flex-1" />
            <label className="flex items-center gap-2">
              {t('Marks')}
              <Select aria-label={t('Marks')} className="min-w-20" value={q.marks} onChange={(e) => update(i, { marks: Number(e.target.value) })}>
                {Array.from({ length: 10 }, (_, n) => <option key={n + 1} value={n + 1}>{n + 1}</option>)}
              </Select>
            </label>
          </div>
        </Panel>
      ))}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="quiet" disabled={questions.length >= 100} onClick={() => setQuestions([...questions, blank()])}><Plus className="size-4" /> {t('Add question')}</Button>
        <span className="flex-1 text-sm text-muted-foreground">{problem}</span>
        <Button disabled={!!problem || save.busy} onClick={() => save.run()}>{t('Save quiz')}</Button>
      </div>
      <ErrorNote message={load.error ?? save.error} />
    </div>
  );
}
