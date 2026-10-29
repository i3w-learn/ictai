import { useEffect, useState } from 'react';
import { quizRoom, type StudentRunState } from '@ict/contracts';
import { useApp, useLiveState } from '../../app/app-context';
import { ApiCallError } from '../../core/api-client';
import { Button, Centered, ErrorNote, PageTitle, useAction } from '../../ui/ui';
import { RelayChip } from './RelayChip';

// A student taking a Lab Mode quiz at their own pace (v2's Join page).
// Each question has its own countdown; when it runs out the quiz moves on unanswered.
export function PlayQuiz({ initial, onExit }: { initial: StudentRunState; onExit: () => void }) {
  const { call } = useApp();
  const read = () => call('GET /api/v1/quiz-runs/:id/play', { params: { id: initial.runId } });
  const [state, setLocal] = useLiveState<StudentRunState>(quizRoom(initial.runId), initial, read);
  const run = state ?? initial;
  const [mine, setMine] = useState<(number | null)[]>(initial.myAnswers);
  const [skipped, setSkipped] = useState<Set<number>>(new Set());

  // The server's answers win; local ones fill the gap until it confirms.
  const answers = run.myAnswers.map((a, i) => a ?? mine[i] ?? null);
  const current = run.status === 'active' && !run.finished ? answers.findIndex((a, i) => a == null && !skipped.has(i)) : -1;

  const finish = useAction(async () => setLocal(await call('POST /api/v1/quiz-runs/:id/finish', { params: { id: run.runId } })));

  const answer = useAction(async (choice: number) => {
    const questionIndex = current;
    try {
      await call('POST /api/v1/quiz-runs/:id/answers', { params: { id: run.runId }, body: { questionIndex, choice } });
      setMine((m) => m.map((x, i) => (i === questionIndex ? choice : x)));
    } catch (e) {
      // The quiz ended or we finished elsewhere: show what the server says now.
      if (e instanceof ApiCallError && e.status === 409) setLocal(await read());
      else throw e;
    }
  });

  // Every question answered or skipped: hand in.
  useEffect(() => {
    if (run.status === 'active' && !run.finished && current === -1 && !finish.busy) void finish.run();
  }, [run.status, run.finished, current]);

  const header = (
    <div className="flex items-center gap-3">
      <span className="flex-1 font-display text-lg font-semibold">{run.title}</span>
      <RelayChip />
    </div>
  );

  if (run.status === 'lobby') {
    return (
      <Centered>
        {header}
        <PageTitle sub="Your teacher will start the quiz soon. Keep this screen open.">You're in!</PageTitle>
      </Centered>
    );
  }

  if (run.finished || run.status === 'ended' || current === -1) {
    return (
      <Centered>
        {header}
        <PageTitle
          eyebrow={run.status === 'ended' ? 'Quiz ended' : 'Quiz done'}
          sub={run.status === 'ended' ? 'Your teacher has ended the quiz.' : 'Wait for your teacher to end the quiz.'}
        >
          {run.score == null ? 'Handing in…' : `You scored ${run.score} out of ${run.totalMarks}`}
        </PageTitle>
        <ErrorNote message={finish.error} />
        <div><Button variant="quiet" onClick={onExit}>Back to home</Button></div>
      </Centered>
    );
  }

  const q = run.questions[current]!;
  return (
    <Centered>
      {header}
      <Countdown
        key={current}
        seconds={run.secondsPerQuestion}
        onTimeUp={() => setSkipped((s) => new Set(s).add(current))}
      />
      <p className="text-sm text-muted-foreground">Question {current + 1} of {run.questions.length}</p>
      <h1 className="font-display text-2xl font-semibold text-balance">{q.text}</h1>
      <div className="grid gap-3">
        {q.options.map((o, i) => (
          <button
            key={i}
            disabled={answer.busy}
            onClick={() => void answer.run(i)}
            className="flex min-h-14 cursor-pointer items-center gap-3 rounded-xl border border-border bg-card px-4 text-left text-[16px] font-medium hover:border-primary disabled:opacity-60"
          >
            <span className="flex size-8 shrink-0 items-center justify-center rounded-full border-2 border-primary/40 text-sm font-bold text-primary">
              {String.fromCharCode(65 + i)}
            </span>
            {o}
          </button>
        ))}
      </div>
      <ErrorNote message={answer.error} />
    </Centered>
  );
}

function Countdown({ seconds, onTimeUp }: { seconds: number; onTimeUp: () => void }) {
  const [deadline] = useState(() => Date.now() + seconds * 1000);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, deadline - now);
  useEffect(() => {
    if (left === 0) onTimeUp();
  }, [left === 0]);

  const secs = Math.ceil(left / 1000);
  return (
    <div className="grid gap-1.5">
      <div className="h-2 overflow-hidden rounded-full bg-secondary">
        <div className="h-full bg-primary transition-[width] duration-200" style={{ width: `${(left / (seconds * 1000)) * 100}%` }} />
      </div>
      <span className="text-right text-xs tabular-nums text-muted-foreground">
        {Math.floor(secs / 60)}:{String(secs % 60).padStart(2, '0')} left
      </span>
    </div>
  );
}
