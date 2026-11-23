import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowLeft, Printer, Sparkles } from 'lucide-react';
import { PLAN_MINUTES, type AiPlanJob, type AiPlanRequest, type AiPlanResult, type SchoolClass } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, ErrorNote, Field, Note, Panel, Select, useAction } from '../../ui/ui';
import { AiUnavailable, LANGUAGES } from '../ai/ai-shared';
import { useAiJob } from '../ai/useAiJob';
import { KIND_WORDS } from '../content/files';
import { SubjectField } from './SubjectField';

// The plan itself, the same on the screen and on paper.
function Plan({ request, result, className }: { request: AiPlanRequest; result: AiPlanResult; className: string }) {
  return (
    <div className="grid gap-5 text-[0.9375rem] leading-relaxed">
      <p className="text-muted-foreground">Class {className} · {request.subject} · {request.minutes} minutes</p>
      {result.objectives.length > 0 && (
        <section className="grid gap-1.5">
          <h3 className="font-display text-base font-semibold">By the end, students can</h3>
          <ul className="list-disc pl-5">{result.objectives.map((o, i) => <li key={i}>{o}</li>)}</ul>
        </section>
      )}
      <section className="grid gap-1.5">
        <h3 className="font-display text-base font-semibold">The lesson</h3>
        <table className="w-full">
          <tbody>
            {result.steps.map((s, i) => (
              <tr key={i} className="break-inside-avoid border-t border-border align-top">
                <td className="w-20 py-2 pr-3 font-semibold whitespace-nowrap tabular-nums">{s.minutes} min</td>
                <td className="py-2"><b>{s.title}</b>{s.what && <span className="block text-secondary-foreground">{s.what}</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      {result.checks.length > 0 && (
        <section className="grid gap-1.5">
          <h3 className="font-display text-base font-semibold">Ask the class</h3>
          <ol className="list-decimal pl-5">{result.checks.map((c, i) => <li key={i}>{c}</li>)}</ol>
        </section>
      )}
      {result.homework && (
        <section className="grid gap-1.5">
          <h3 className="font-display text-base font-semibold">Homework</h3>
          <p>{result.homework}</p>
        </section>
      )}
      {result.library.length > 0 && (
        <section className="grid gap-1.5">
          <h3 className="font-display text-base font-semibold">In your library for this class and subject</h3>
          <ul className="list-disc pl-5">{result.library.map((l, i) => <li key={i}>{l.title} <span className="text-muted-foreground">· {KIND_WORDS[l.kind as keyof typeof KIND_WORDS] ?? l.kind}{l.chapter ? ` · ${l.chapter}` : ''}</span></li>)}</ul>
        </section>
      )}
    </div>
  );
}

// A plain page of the plan. The print window can send it to a printer or save it as a PDF.
function PlanSheet({ job, className, onClose }: { job: AiPlanJob; className: string; onClose: () => void }) {
  return createPortal(
    <div className="print-sheet fixed inset-0 z-50 overflow-y-auto bg-card px-8 py-6 text-foreground">
      <div className="no-print mb-5 flex flex-wrap items-center gap-3">
        <span className="flex-1" />
        <Button onClick={() => window.print()}>Print or save as PDF</Button>
        <Button variant="quiet" onClick={onClose}>Close</Button>
      </div>
      <h2 className="mb-3 font-display text-2xl font-semibold">Lesson plan: {job.request.topic}</h2>
      {job.result && <Plan request={job.request} result={job.result} className={className} />}
    </div>,
    document.body,
  );
}

// Spec 4.3 "Plan a lesson (AI)": a class, a subject, a topic and a length go in; a timed plan comes
// out, written by the AI on the Server PC. The teacher reads it, prints it, and teaches her own way.
export function LessonPlan({ onBack }: { onBack: () => void }) {
  const { call } = useApp();
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [form, setForm] = useState({ classId: '', subject: '', topic: '', minutes: String(PLAN_MINUTES.usual), language: 'en' as AiPlanRequest['language'] });
  const [printing, setPrinting] = useState(false);
  const ai = useAiJob('plan');

  const loadClasses = useAction(async () => setClasses(await call('GET /api/v1/classes')));
  const { run: loadClassesNow } = loadClasses;
  useEffect(() => { void loadClassesNow(); }, [loadClassesNow]);

  const minutes = Number(form.minutes);
  const problem =
    !form.classId ? 'Pick a class.'
    : !form.subject.trim() ? 'Choose the subject.'
    : !form.topic.trim() ? 'Type the topic.'
    : !(Number.isInteger(minutes) && minutes >= PLAN_MINUTES.min && minutes <= PLAN_MINUTES.max) ? `A lesson is ${PLAN_MINUTES.min} to ${PLAN_MINUTES.max} minutes.`
    : ai.busyElsewhere ? 'Another AI request of yours is still running. Plan the lesson when it is done.'
    : null;

  const make = useAction(async () => {
    ai.follow(await call('POST /api/v1/ai/plan', { query: {}, body: { classId: form.classId, subject: form.subject, topic: form.topic, minutes, language: form.language } }));
  });
  const canMake = !problem && !make.busy && ai.canStart;

  const className = (id: string) => classes.find((c) => c.id === id)?.name ?? '?';
  const job = ai.job;
  const earlier = ai.recent.filter((j) => j.status === 'done' && j.id !== job?.id);

  return (
    <div className="mx-auto grid max-w-4xl gap-6">
      {printing && job?.result && <PlanSheet job={job} className={className(job.request.classId)} onClose={() => setPrinting(false)} />}
      <div className="flex items-center gap-3">
        <Button variant="quiet" onClick={onBack}><ArrowLeft className="size-4" /> Quizzes</Button>
        <h1 className="font-display text-2xl font-semibold">Plan a lesson with AI</h1>
      </div>

      {ai.status && !ai.usable ? <AiUnavailable status={ai.status} /> : ai.status && (
        <>
          <Panel title="What is the lesson about?">
            <div className="flex flex-wrap items-end gap-3">
              <label className="grid gap-1.5">
                <span className="text-[0.8125rem] font-medium text-muted-foreground">Class</span>
                <Select aria-label="Class" value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value })}>
                  <option value="">Choose a class</option>
                  {classes.map((c) => <option key={c.id} value={c.id}>Class {c.name}</option>)}
                </Select>
              </label>
              <SubjectField id="plan-subject" placeholder="Maths" value={form.subject} onChange={(subject) => setForm({ ...form, subject })} />
              <Field id="plan-topic" className="w-64" label="Topic" placeholder="Fractions" maxLength={120} value={form.topic} onChange={(e) => setForm({ ...form, topic: e.target.value })} />
              <Field id="plan-minutes" className="w-32" label="Minutes" inputMode="numeric" value={form.minutes} onChange={(e) => setForm({ ...form, minutes: e.target.value })} />
              <label className="grid gap-1.5">
                <span className="text-[0.8125rem] font-medium text-muted-foreground">Language</span>
                <Select aria-label="Language" className="min-w-40" value={form.language} onChange={(e) => setForm({ ...form, language: e.target.value as AiPlanRequest['language'] })}>
                  {Object.entries(LANGUAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </Select>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-3">
              <Button disabled={!canMake} onClick={() => make.run()}><Sparkles className="size-4" /> Plan the lesson</Button>
              <span className="text-sm text-muted-foreground">{problem ?? 'The AI runs on the Server PC. Nothing leaves the school.'}</span>
            </div>
            <ErrorNote message={make.error} />
          </Panel>

          {job && (
            <Panel title={`Lesson plan: ${job.request.topic}`} actions={job.status === 'done' && job.result && <Button variant="quiet" onClick={() => setPrinting(true)}><Printer className="size-4" /> Print or PDF</Button>}>
              {job.status === 'queued' && <Note>You are number {job.position} in line. Your plan starts after the ones before it.</Note>}
              {job.status === 'running' && <Note>Writing your plan… this can take a few minutes. You can keep working; it will be under Earlier plans.</Note>}
              {ai.trouble && <Note>{ai.trouble}</Note>}
              {job.status === 'failed' && (
                <div className="grid gap-3">
                  <ErrorNote message={job.error} />
                  <div><Button variant="quiet" onClick={() => setForm({ classId: job.request.classId, subject: job.request.subject, topic: job.request.topic, minutes: String(job.request.minutes), language: job.request.language })}>Try again</Button></div>
                </div>
              )}
              {job.status === 'done' && job.result && (
                <>
                  <Plan request={job.request} result={job.result} className={className(job.request.classId)} />
                  <p className="text-sm text-muted-foreground">The AI can be wrong. Read the plan through before you teach from it.</p>
                </>
              )}
            </Panel>
          )}

          {earlier.length > 0 && (
            <Panel title="Earlier plans">
              <ul className="grid gap-2">
                {earlier.map((j) => (
                  <li key={j.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-border px-3 py-2">
                    <span className="min-w-48 flex-1 truncate font-medium">{j.request.topic}</span>
                    <span className="text-xs text-muted-foreground">{[`Class ${className(j.request.classId)}`, j.request.subject, `${j.request.minutes} min`].join(' · ')}</span>
                    <Button variant="quiet" disabled={ai.waiting} onClick={() => ai.follow(j)}>Show plan</Button>
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
