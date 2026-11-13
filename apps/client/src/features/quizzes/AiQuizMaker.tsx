import { useEffect, useState } from 'react';
import { ArrowLeft, Sparkles } from 'lucide-react';
import type { AiQuizJob, AiQuizRequest, AiQuizResult, SchoolClass } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, ErrorNote, Field, Note, Panel, Select, useAction } from '../../ui/ui';
import { AiUnavailable, LANGUAGES } from '../ai/ai-shared';
import { useAiJob } from '../ai/useAiJob';
import { SubjectField } from './SubjectField';

export type AiDraft = { request: AiQuizRequest; result: AiQuizResult };

// Spec 9 /ai/quiz: the AI on the Server PC writes a draft; the teacher checks it in the editor.
export function AiQuizMaker({ onDraft, onBack }: { onDraft: (d: AiDraft) => void; onBack: () => void }) {
  const { call } = useApp();
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [form, setForm] = useState({ classId: '', subject: '', topic: '', count: '10', language: 'en' as AiQuizRequest['language'] });
  const ai = useAiJob('quiz');

  const loadClasses = useAction(async () => setClasses(await call('GET /api/v1/classes')));
  useEffect(() => { void loadClasses.run(); }, []);

  const count = Number(form.count);
  const problem =
    !form.classId ? 'Pick a class.'
    : !form.subject.trim() ? 'Choose the subject.'
    : !form.topic.trim() ? 'Type the topic.'
    : !(Number.isInteger(count) && count >= 1 && count <= 20) ? 'Ask for 1 to 20 questions.'
    : ai.busyElsewhere ? 'Your question is still being answered. Make the quiz when it is done.'
    : null;

  const make = useAction(async () => {
    ai.follow(await call('POST /api/v1/ai/quiz', { query: {}, body: { classId: form.classId, subject: form.subject, topic: form.topic, count, language: form.language } }));
  });
  const canMake = !problem && !make.busy && ai.canStart;

  const className = (id: string) => classes.find((c) => c.id === id)?.name ?? '?';
  const open = (j: AiQuizJob) => j.result && onDraft({ request: j.request, result: j.result });
  const job = ai.job;
  const done = ai.recent.filter((j) => j.status === 'done');

  return (
    <div className="mx-auto grid max-w-4xl gap-6">
      <div className="flex items-center gap-3">
        <Button variant="quiet" onClick={onBack}><ArrowLeft className="size-4" /> Quizzes</Button>
        <h1 className="font-display text-2xl font-semibold">Make a quiz with AI</h1>
      </div>

      {ai.status && !ai.usable ? <AiUnavailable status={ai.status} /> : ai.status && (
        <>
          <Panel title="What should the quiz be about?">
            <div className="flex flex-wrap items-end gap-3">
              <label className="grid gap-1.5">
                <span className="text-[13px] font-medium text-muted-foreground">Class</span>
                <Select aria-label="Class" value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })}>
                  <option value="">Choose a class</option>
                  {classes.map((c) => <option key={c.id} value={c.id}>Class {c.name}</option>)}
                </Select>
              </label>
              <SubjectField id="ai-subject" placeholder="Maths" value={form.subject} onChange={(subject) => setForm({ ...form, subject })} />
              <Field id="ai-topic" className="w-64" label="Topic" placeholder="Fractions" value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} />
              <Field id="ai-count" className="w-32" label="Questions" inputMode="numeric" value={form.count} onChange={(e) => setForm({ ...form, count: e.target.value })} />
              <label className="grid gap-1.5">
                <span className="text-[13px] font-medium text-muted-foreground">Language</span>
                <Select aria-label="Language" className="min-w-40" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value as AiQuizRequest['language'] })}>
                  {Object.entries(LANGUAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button disabled={!canMake} onClick={() => make.run()}><Sparkles className="size-4" /> Make quiz</Button>
              <span className="text-sm text-muted-foreground">{problem}</span>
            </div>
            <ErrorNote message={make.error} />
          </Panel>

          {job && (
            <Panel title={`${job.request.topic} · Class ${className(job.request.classId)}`}>
              {job.status === 'queued' && <Note>You are number {job.position} in line. Your quiz starts after the ones before it.</Note>}
              {job.status === 'running' && <Note>Making your quiz… this can take a few minutes. You can keep working; it will be under Recent AI quizzes.</Note>}
              {ai.trouble && <Note>{ai.trouble}</Note>}
              {job.status === 'failed' && <ErrorNote message={job.error} />}
              {job.status === 'done' && job.result && (
                <div className="flex flex-wrap items-center gap-3">
                  <span className="flex-1">
                    {job.result.questions.length} questions ready.{' '}
                    {job.result.flags.filter((f) => !f.ok).length > 0 && (
                      <span className="text-destructive">{job.result.flags.filter((f) => !f.ok).length} need checking.</span>
                    )}
                  </span>
                  <Button onClick={() => open(job)}>Open in editor</Button>
                </div>
              )}
            </Panel>
          )}

          {done.length > 0 && (
            <Panel title="Recent AI quizzes">
              <ul className="grid gap-2">
                {done.map((j) => (
                  <li key={j.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border px-3 py-2">
                    <span className="min-w-48 flex-1">
                      <span className="font-medium">{j.request.topic}</span>
                      <span className="ml-2 text-xs text-muted-foreground">
                        {[`Class ${className(j.request.classId)}`, j.request.subject, `${j.result?.questions.length ?? 0} questions`, LANGUAGES[j.request.language]].join(' · ')}
                      </span>
                    </span>
                    <Button variant="quiet" onClick={() => open(j)}>Open in editor</Button>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </>
      )}
      <ErrorNote message={ai.load.error ?? loadClasses.error} />
    </div>
  );
}
