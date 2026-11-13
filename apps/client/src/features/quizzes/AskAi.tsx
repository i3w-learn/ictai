import { useState } from 'react';
import { ArrowLeft, Sparkles } from 'lucide-react';
import { AI_QUESTION_MAX, type AiAskRequest } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, ErrorNote, Note, Panel, Select, useAction } from '../../ui/ui';
import { AiUnavailable, LANGUAGES } from '../ai/ai-shared';
import { useAiJob } from '../ai/useAiJob';

// Spec 9 /ai/ask: a teacher types a question and the AI on the Server PC answers in plain text.
// Nothing leaves the school; the answer may take a minute and may be wrong, so the screen says so.
export function AskAi({ onBack }: { onBack: () => void }) {
  const { call } = useApp();
  const [question, setQuestion] = useState('');
  const [language, setLanguage] = useState<AiAskRequest['language']>('en');
  const ai = useAiJob('ask');

  const ask = useAction(async () => {
    ai.follow(await call('POST /api/v1/ai/ask', { query: {}, body: { question, language } }));
    setQuestion('');
  });
  // One rule for the button and for pressing Enter.
  const canAsk = !!question.trim() && !ask.busy && ai.canStart;

  const job = ai.job;
  const earlier = ai.recent.filter((j) => j.status === 'done' && j.id !== job?.id);

  return (
    <div className="mx-auto grid max-w-4xl gap-6">
      <div className="flex items-center gap-3">
        <Button variant="quiet" onClick={onBack}><ArrowLeft className="size-4" /> Quizzes</Button>
        <h1 className="font-display text-2xl font-semibold">Ask AI</h1>
      </div>

      {ai.status && !ai.usable ? <AiUnavailable status={ai.status} /> : ai.status && (
        <>
          <Panel title="What do you want to ask?">
            <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (canAsk) void ask.run(); }}>
              <label className="grid gap-1.5" htmlFor="ask-question">
                <span className="text-[13px] font-medium text-muted-foreground">Your question</span>
                <textarea
                  id="ask-question" rows={4} maxLength={AI_QUESTION_MAX} placeholder="Why does the moon change shape during the month?"
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
                <Button type="submit" disabled={!canAsk}><Sparkles className="size-4" /> Ask</Button>
                <span className="text-sm text-muted-foreground">
                  {ai.busyElsewhere ? 'Your quiz is still being made. Ask when it is done.' : 'The AI runs on the Server PC. Nothing leaves the school.'}
                </span>
              </div>
              <ErrorNote message={ask.error} />
            </form>
          </Panel>

          {job && (
            <Panel title="Your question">
              <p className="text-[15px] font-medium whitespace-pre-wrap">{job.request.question}</p>
              {job.status === 'queued' && <Note>You are number {job.position} in line. Your answer starts after the ones before it.</Note>}
              {job.status === 'running' && <Note>Writing your answer… this can take a minute. You can keep working; it will be under Earlier questions.</Note>}
              {ai.trouble && <Note>{ai.trouble}</Note>}
              {job.status === 'failed' && (
                <div className="grid gap-3">
                  <ErrorNote message={job.error} />
                  <div><Button variant="quiet" onClick={() => setQuestion(job.request.question)}>Try again</Button></div>
                </div>
              )}
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
                    <Button variant="quiet" disabled={ai.waiting} onClick={() => ai.follow(j)}>Show answer</Button>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </>
      )}
      <ErrorNote message={ai.load.error} />
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
