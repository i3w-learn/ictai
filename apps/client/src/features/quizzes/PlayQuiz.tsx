import { useEffect, useState } from 'react';
import { quizRoom, type StudentRunState } from '@ict/contracts';
import { useApp, useLiveState } from '../../app/app-context';
import { ApiCallError } from '../../core/api-client';
import { Button, Centered, ErrorNote, PageTitle, useAction } from '../../ui/ui';

// A student taking a Lab Mode quiz at their own pace (v2's Join page).
// The server keeps each question's clock and says which question the student is on (`current`),
// so reloading this page cannot win time back. This screen only shows what the server says.
export function PlayQuiz({ initial, onExit }: { initial: StudentRunState; onExit: () => void }) {
  const { call } = useApp();
  const read = () => call('GET /api/v1/quiz-runs/:id/play', { params: { id: initial.runId } });
  const [state, setLocal, liveError] = useLiveState<StudentRunState>(quizRoom(initial.runId), initial, read);
  const run = state ?? initial;
  const current = run.status === 'active' && !run.finished ? run.current : null;

  const finish = useAction(async () => setLocal(await call('POST /api/v1/quiz-runs/:id/finish', { params: { id: run.runId } })));

  const answer = useAction(async (choice: number) => {
    if (!current) return;
    try {
      await call('POST /api/v1/quiz-runs/:id/answers', { params: { id: run.runId }, body: { questionIndex: current.index, choice } });
    } catch (e) {
      // Time ran out, the quiz ended, or we finished elsewhere: show what the server says now.
      if (!(e instanceof ApiCallError && e.status === 409)) throw e;
    }
    setLocal(await read());
  });

  // The countdown reached zero: the server marks the question and says what comes next.
  const timeUp = useAction(async () => setLocal(await read()));

  // Every question answered or out of time: hand in.
  useEffect(() => {
    if (run.status === 'active' && !run.finished && !run.current && !finish.busy) void finish.run();
  }, [run.status, run.finished, run.current == null]);

  const header = (
    <div className="flex items-center gap-3">
      <span className="flex-1 font-display text-lg font-semibold">{run.title}</span>
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

  if (run.finished || run.status === 'ended' || !current) {
    return (
      <Centered>
        {header}
        <PageTitle
          eyebrow={run.status === 'ended' ? 'Quiz ended' : 'Quiz done'}
          sub={run.status === 'ended' ? 'Your teacher has ended the quiz.' : 'Wait for your teacher to end the quiz.'}
        >
          {run.score == null ? 'Handing in…' : `You scored ${run.score} out of ${run.totalMarks}`}
        </PageTitle>
        <ErrorNote message={liveError ?? finish.error ?? timeUp.error} />
        <div><Button variant="quiet" onClick={onExit}>Back to home</Button></div>
      </Centered>
    );
  }

  const q = run.questions[current.index]!;
  return (
    <Centered>
      {header}
      <Countdown
        key={current.index}
        seconds={run.secondsPerQuestion}
        remainingMs={current.remainingMs}
        onTimeUp={() => void timeUp.run()}
      />
      <p className="text-sm text-muted-foreground">Question {current.index + 1} of {run.questions.length}</p>
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
      <ErrorNote message={liveError ?? answer.error ?? timeUp.error} />
    </Centered>
  );
}

// Counts down the time the server says is left. Each fresh word from the server (a new
// `remainingMs`) sets the clock again, so this PC's clock only has to be right for a few seconds.
function Countdown({ seconds, remainingMs, onTimeUp }: { seconds: number; remainingMs: number; onTimeUp: () => void }) {
  const [deadline, setDeadline] = useState(() => Date.now() + remainingMs);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    setDeadline(Date.now() + remainingMs);
    setNow(Date.now());
  }, [remainingMs]);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, deadline - now);
  // At zero, ask the server what is next; keep asking every few seconds in case a call fails.
  useEffect(() => {
    if (left !== 0) return;
    onTimeUp();
    const t = setInterval(onTimeUp, 3000);
    return () => clearInterval(t);
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
