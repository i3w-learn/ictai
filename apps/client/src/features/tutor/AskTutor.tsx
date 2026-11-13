import { useEffect, useState } from 'react';
import { ArrowLeft, Sparkles } from 'lucide-react';
import type { AiTutorJob, MyTutor } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { ApiCallError } from '../../core/api-client';
import { Button, Card, ErrorNote, Note, PageTitle, useAction } from '../../ui/ui';

// PRD student app "Ask": the student types a question and the AI on the Server PC gives a hint in
// simple words. A few questions a day, one at a time. Nothing leaves the school.
export function AskTutor({ onBack }: { onBack: () => void }) {
  const { call } = useApp();
  const [mine, setMine] = useState<MyTutor | null>(null);
  const [off, setOff] = useState<string | null>(null);
  const [question, setQuestion] = useState('');
  const [job, setJob] = useState<AiTutorJob | null>(null);

  const load = useAction(async () => {
    const m = await call('GET /api/v1/ai/tutor');
    setMine(m);
    // Pick up a question still being answered, e.g. after leaving this screen.
    setJob((cur) => cur ?? m.jobs.find((j) => j.status === 'queued' || j.status === 'running') ?? null);
  });
  useEffect(() => { void load.run(); }, []);

  const waiting = job?.status === 'queued' || job?.status === 'running';
  useEffect(() => {
    if (!waiting || !job) return;
    const timer = setInterval(() => {
      call('GET /api/v1/ai/tutor/:id', { params: { id: job.id } }).then((j) => {
        setJob(j);
        if (j.status === 'done' || j.status === 'failed') void load.run();
      }, () => {});
    }, 3000);
    return () => clearInterval(timer);
  }, [waiting, job?.id]);

  const ask = useAction(async () => {
    try {
      setJob(await call('POST /api/v1/ai/tutor', { body: { question } }));
      setQuestion('');
      await load.run();
    } catch (e) {
      // AI switched off, or not installed on this server: say it plainly instead of as a fault.
      if (e instanceof ApiCallError && (e.code === 'AI_OFF' || e.code === 'AI_NOT_INSTALLED')) return setOff('The helper is not switched on in your school right now. Ask your teacher.');
      throw e;
    }
  });

  const earlier = (mine?.jobs ?? []).filter((j) => j.status === 'done' && j.id !== job?.id);
  const none = mine !== null && mine.leftToday === 0;
  return (
    <div className="mx-auto grid w-full max-w-3xl gap-5">
      <div><Button variant="quiet" onClick={onBack}><ArrowLeft className="size-4" /> Back</Button></div>
      <PageTitle sub="Ask about something you are learning. You get a hint and an explanation, so you can work out the answer yourself.">Ask</PageTitle>
      {off ? <Note>{off}</Note> : (
        <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (question.trim() && !waiting && !none) void ask.run(); }}>
          <label className="grid gap-1.5" htmlFor="tutor-question">
            <span className="text-[13px] font-medium text-muted-foreground">Your question</span>
            <textarea
              id="tutor-question" rows={3} maxLength={600} placeholder="What is a fraction?"
              className="w-full resize-y rounded-xl border border-border bg-card px-3 py-2.5 text-lg text-foreground placeholder:text-muted-foreground/60"
              value={question} onChange={(e) => setQuestion(e.target.value)}
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" className="h-12 px-6" disabled={!question.trim() || ask.busy || waiting || none}><Sparkles className="size-4" /> Ask</Button>
            {mine && <span className="text-muted-foreground">{none ? `You have asked ${mine.dailyCap} questions today. You can ask more tomorrow.` : `${mine.leftToday} of ${mine.dailyCap} questions left today.`}</span>}
          </div>
          <ErrorNote message={ask.error} />
        </form>
      )}

      {job && (
        <Card className="grid gap-3 p-5">
          <p className="font-semibold">{job.request.question}</p>
          {job.status === 'queued' && <Note>You are number {job.position} in line. Your answer is coming.</Note>}
          {job.status === 'running' && <Note>Thinking… this can take a minute.</Note>}
          {job.status === 'failed' && <ErrorNote message={job.error} />}
          {job.status === 'done' && job.result && (
            <>
              <p className="text-lg leading-relaxed whitespace-pre-wrap">{job.result.answer}</p>
              <p className="text-sm text-muted-foreground">The helper can be wrong. If something looks odd, ask your teacher.</p>
            </>
          )}
        </Card>
      )}

      {earlier.length > 0 && (
        <Card className="grid gap-2 p-5">
          <h2 className="text-lg font-semibold">Your earlier questions</h2>
          <ul className="grid gap-2">
            {earlier.map((j) => (
              <li key={j.id}><button type="button" disabled={waiting} onClick={() => setJob(j)} className="w-full cursor-pointer rounded-xl border border-border px-3 py-2 text-left hover:border-accent/50 disabled:cursor-not-allowed">{j.request.question}</button></li>
            ))}
          </ul>
        </Card>
      )}
      <ErrorNote message={load.error} />
    </div>
  );
}
