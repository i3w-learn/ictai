import { useEffect, useState } from 'react';
import { ArrowLeft, Sparkles } from 'lucide-react';
import type { AiAskJob, AiAskRequest, AiStatus } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, ErrorNote, Note, Panel, Select, useAction } from '../../ui/ui';

const LANGUAGES = { en: 'English', hi: 'हिंदी (Hindi)' } as const;
const QUESTION_MAX = 2000;

// Spec 9 /ai/ask: a teacher types a question and the AI on the Server PC answers in plain text.
// Nothing leaves the school; the answer may take a minute and may be wrong, so the screen says so.
export function AskAi({ onBack }: { onBack: () => void }) {
  const { call } = useApp();
  const [status, setStatus] = useState<AiStatus | null>(null);
  const [recent, setRecent] = useState<AiAskJob[]>([]);
  const [question, setQuestion] = useState('');
  const [language, setLanguage] = useState<AiAskRequest['language']>('en');
  const [job, setJob] = useState<AiAskJob | null>(null);

  const load = useAction(async () => {
    const [s, jobs] = await Promise.all([call('GET /api/v1/ai/status'), call('GET /api/v1/ai/jobs')]);
    // This screen is about questions; AI quizzes live on their own screen.
    const asks = jobs.filter((j): j is AiAskJob => j.kind === 'ask');
    setStatus(s);
    setRecent(asks);
    // Pick up a question still being answered, e.g. after leaving this screen.
    setJob((cur) => cur ?? asks.find((j) => j.status === 'queued' || j.status === 'running') ?? null);
  });
  useEffect(() => { void load.run(); }, []);

  // While the answer is being written, ask the server every 3 s how it is going.
  const waiting = job?.status === 'queued' || job?.status === 'running';
  useEffect(() => {
    if (!waiting || !job) return;
    const timer = setInterval(() => {
      call('GET /api/v1/ai/jobs/:id', { params: { id: job.id } }).then((j) => {
        if (j.kind !== 'ask') return;
        setJob(j);
        if (j.status === 'done' || j.status === 'failed') void load.run();
      }, () => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [waiting, job?.id]);

  const ask = useAction(async () => {
    setJob(await call('POST /api/v1/ai/ask', { query: {}, body: { question, language } }));
    setQuestion('');
  });

  const earlier = recent.filter((j) => j.status === 'done' && j.id !== job?.id);

  return (
    <div className="mx-auto grid max-w-4xl gap-6">
      <div className="flex items-center gap-3">
        <Button variant="quiet" onClick={onBack}><ArrowLeft className="size-4" /> Quizzes</Button>
        <h1 className="font-display text-2xl font-semibold">Ask AI</h1>
      </div>

      {status && !status.enabled ? (
        <p className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
          AI is switched off for this school. The Super Admin can switch it on in Settings.
        </p>
      ) : status && !status.installed ? (
        <p className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
          AI is not installed on this server. Ask your Super Admin to install the AI kit.
        </p>
      ) : status && (
        <>
          <Panel title="What do you want to ask?">
            <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (question.trim() && !waiting) void ask.run(); }}>
              <label className="grid gap-1.5" htmlFor="ask-question">
                <span className="text-[13px] font-medium text-muted-foreground">Your question</span>
                <textarea
                  id="ask-question" rows={4} maxLength={QUESTION_MAX} placeholder="Why does the moon change shape during the month?"
                  className="w-full resize-y rounded-xl border border-border bg-card px-3 py-2.5 text-[15px] leading-relaxed text-foreground placeholder:text-muted-foreground/60"
                  value={question} onChange={(e) => setQuestion(e.target.value)}
                />
              </label>
              <div className="flex flex-wrap items-end gap-3">
                <label className="grid gap-1.5">
                  <span className="text-[13px] font-medium text-muted-foreground">Answer in</span>
                  <Select aria-label="Answer in" className="min-w-40" value={language} onChange={(e) => setLanguage(e.target.value as AiAskRequest['language'])}>
                    {Object.entries(LANGUAGES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                  </Select>
                </label>
                <Button type="submit" disabled={!question.trim() || ask.busy || waiting}><Sparkles className="size-4" /> Ask</Button>
                <span className="text-sm text-muted-foreground">The AI runs on the Server PC. Nothing leaves the school.</span>
              </div>
              <ErrorNote message={ask.error} />
            </form>
          </Panel>

          {job && (
            <Panel title={job.request.question}>
              {job.status === 'queued' && <Note>You are number {job.position} in line. Your answer starts after the ones before it.</Note>}
              {job.status === 'running' && <Note>Writing your answer… this can take a minute. You can keep working; it will be under Earlier questions.</Note>}
              {job.status === 'failed' && <ErrorNote message={job.error} />}
              {job.status === 'done' && job.result && <Answer text={job.result.answer} />}
            </Panel>
          )}

          {earlier.length > 0 && (
            <Panel title="Earlier questions">
              <ul className="grid gap-2">
                {earlier.map((j) => (
                  <li key={j.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border px-3 py-2">
                    <span className="min-w-48 flex-1 truncate font-medium">{j.request.question}</span>
                    <span className="text-xs text-muted-foreground">{LANGUAGES[j.request.language]}</span>
                    <Button variant="quiet" disabled={waiting} onClick={() => setJob(j)}>Show answer</Button>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </>
      )}
      <ErrorNote message={load.error} />
    </div>
  );
}

function Answer({ text }: { text: string }) {
  return (
    <div className="grid gap-3">
      <p className="text-[15px] leading-relaxed whitespace-pre-wrap">{text}</p>
      <p className="text-sm text-muted-foreground">The AI can be wrong. Check the answer before you teach it.</p>
    </div>
  );
}
