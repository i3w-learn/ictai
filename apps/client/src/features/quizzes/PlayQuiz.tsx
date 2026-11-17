import { useEffect, useState, type ReactNode } from 'react';
import { quizRoom, type StudentRunState } from '@ict/contracts';
import { useApp, useLiveState } from '../../app/app-context';
import { ApiCallError } from '../../core/api-client';
import { Hourglass, Medal, type LucideIcon } from 'lucide-react';
import { Button, Card, Centered, ErrorNote, PageTitle, useAction, useLatest } from '../../ui/ui';

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
  const allDone = run.status === 'active' && !run.finished && !run.current;
  const { run: finishNow } = finish;
  const finishing = useLatest(finish.busy);
  useEffect(() => {
    if (allDone && !finishing.current) void finishNow();
  }, [allDone, finishNow, finishing]);

  const header = (
    <div className="flex items-center gap-3">
      <span className="flex-1 font-display text-lg font-semibold">{run.title}</span>
    </div>
  );

  // Waiting and score screens: one card in the middle, so the page is not bare text.
  const stage = (Icon: LucideIcon, children: ReactNode) => (
    <Centered>
      <Card className="mx-auto grid w-full max-w-xl justify-items-center gap-6 p-8 text-center sm:p-12">
        <div className="flex size-16 items-center justify-center rounded-3xl bg-primary text-primary-foreground shadow-[0_8px_20px_-8px_var(--primary)]">
          <Icon className="size-8" aria-hidden />
        </div>
        <span className="font-display text-lg font-semibold text-muted-foreground">{run.title}</span>
        {children}
      </Card>
    </Centered>
  );

  if (run.status === 'lobby') {
    return stage(Hourglass, <PageTitle sub="Your teacher will start the quiz soon. Keep this screen open.">You're in!</PageTitle>);
  }

  if (run.finished || run.status === 'ended' || !current) {
    return stage(Medal, <>
      <PageTitle
        eyebrow={run.status === 'ended' ? 'Quiz ended' : 'Quiz done'}
        sub={run.status === 'ended' ? 'Your teacher has ended the quiz.' : 'Wait for your teacher to end the quiz.'}
      >
        {run.score == null ? 'Handing in…' : `You scored ${run.score} out of ${run.totalMarks}`}
      </PageTitle>
      <ErrorNote message={liveError ?? finish.error ?? timeUp.error} />
      <Button onClick={onExit}>Back to home</Button>
    </>);
  }

  const q = run.questions[current.index]!;
  return (
    <Centered>
      {header}
      <Countdown
        // A fresh word from the server starts the clock again.
        key={`${current.index} ${current.remainingMs}`}
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
            className="flex min-h-14 cursor-pointer items-center gap-3 rounded-2xl border border-border bg-card px-4 text-left text-[1rem] font-medium hover:border-primary disabled:opacity-60"
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
// `remainingMs`) makes a new countdown, so this PC's clock only has to be right for a few seconds.
function Countdown({ seconds, remainingMs, onTimeUp }: { seconds: number; remainingMs: number; onTimeUp: () => void }) {
  const [deadline] = useState(() => Date.now() + remainingMs);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, deadline - now);
  // At zero, ask the server what is next; keep asking every few seconds in case a call fails.
  const over = left === 0;
  const timeUp = useLatest(onTimeUp);
  useEffect(() => {
    if (!over) return;
    timeUp.current();
    const t = setInterval(() => timeUp.current(), 3000);
    return () => clearInterval(t);
  }, [over, timeUp]);

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
