import { useEffect, useState, type ReactNode } from 'react';
import { quizRoom, type StudentRunState } from '@ict/contracts';
import { useApp, useLiveState } from '../../app/app-context';
import { ApiCallError } from '../../core/api-client';
import { Hourglass, Medal, type LucideIcon } from 'lucide-react';
import { Button, Card, Centered, ErrorNote, PageTitle, cn, useAction, useLatest } from '../../ui/ui';
import { placeOf, teamLook } from './teams';
import { useT } from '../../i18n/i18n';

// A student taking a Lab Mode quiz at their own pace (v2's Join page).
// The server keeps each question's clock and says which question the student is on (`current`),
// so reloading this page cannot win time back. This screen only shows what the server says.
export function PlayQuiz({ initial, onExit }: { initial: StudentRunState; onExit: () => void }) {
  const { call } = useApp();
  const t = useT();
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

  // Practice: start again from the first question. The best finished try is kept.
  const retry = useAction(async () => setLocal(await call('POST /api/v1/quiz-runs/:id/retry', { params: { id: run.runId } })));
  const practice = run.mode === 'practice';
  const myTeam = run.team != null && (
    <span className={cn('rounded-full px-3 py-1 text-sm font-semibold', teamLook(run.team).chip)}>{t('Team {team}', { team: t(teamLook(run.team).name) })}</span>
  );

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
      {myTeam}
      {practice && <span className="rounded-full bg-secondary px-3 py-1 text-sm font-semibold text-secondary-foreground">{t('Practice')}</span>}
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
    return stage(Hourglass, <>
      <PageTitle sub={t('Your teacher will start the quiz soon. Keep this screen open.')}>{t("You're in!")}</PageTitle>
      {myTeam}
    </>);
  }

  if (run.finished || run.status === 'ended' || !current) {
    return stage(Medal, <>
      <PageTitle
        eyebrow={run.status === 'ended' ? t('Quiz ended') : practice ? t('Practice done') : t('Quiz done')}
        sub={run.status === 'ended' ? t('Your teacher has ended the quiz.') : practice ? t('This is practice. It is not used for your report card.') : t('Wait for your teacher to end the quiz.')}
      >
        {run.score == null ? t('Handing in…') : t('You scored {score} out of {total}', { score: run.score, total: run.totalMarks })}
      </PageTitle>
      {practice && run.best != null && (
        <p className="text-muted-foreground">{t('Best so far: {best} out of {total}', { best: run.best, total: run.totalMarks })} · {t('Tries: {n}', { n: run.tries })}</p>
      )}
      {run.teams && (
        <div className="grid w-full gap-2 text-left">
          <span className="text-sm font-semibold text-muted-foreground">{t('Teams')}</span>
          {run.teams.map((team, i) => (
            <div key={team.team} className={cn('flex items-center gap-3 rounded-2xl border px-4 py-2.5', team.team === run.team ? 'border-primary bg-primary/5' : 'border-border')}>
              <span className="w-5 tabular-nums text-muted-foreground">{placeOf(run.teams!, i)}</span>
              <span className={cn('size-3 rounded-full', teamLook(team.team).dot)} />
              <span className="flex-1 font-semibold">{t('Team {team}', { team: t(teamLook(team.team).name) })}{team.team === run.team && <span className="ml-2 text-sm font-normal text-muted-foreground">{t('Your team')}</span>}</span>
              <span className="tabular-nums">{t('{score} marks on average', { score: team.score })}</span>
            </div>
          ))}
        </div>
      )}
      <ErrorNote message={liveError ?? finish.error ?? timeUp.error ?? retry.error} />
      {practice && run.status === 'active' && run.finished && <Button disabled={retry.busy} onClick={() => retry.run()}>{t('Try again')}</Button>}
      <Button variant={practice && run.status === 'active' && run.finished ? 'quiet' : 'primary'} onClick={onExit}>{t('Back to home')}</Button>
    </>);
  }

  const q = run.questions[current.index]!;
  return (
    // Packed closer than other pages: the clock, the question and all four answers should fit on a small
    // lab monitor without scrolling, even with the student's text set to Very large.
    <div className="mx-auto grid w-full max-w-3xl gap-3">
      {header}
      {/* Practice has no clock: the server sends no time left. */}
      {current.remainingMs != null && (
        <Countdown
          // A fresh word from the server starts the clock again.
          key={`${current.index} ${current.remainingMs}`}
          seconds={run.secondsPerQuestion}
          remainingMs={current.remainingMs}
          onTimeUp={() => void timeUp.run()}
        />
      )}
      <p className="text-sm text-muted-foreground">{t('Question {n} of {total}', { n: current.index + 1, total: run.questions.length })}</p>
      <h1 className="font-display text-2xl font-semibold text-balance">{q.text}</h1>
      <div className="mt-1 grid gap-2">
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
    </div>
  );
}

// Counts down the time the server says is left. Each fresh word from the server (a new
// `remainingMs`) makes a new countdown, so this PC's clock only has to be right for a few seconds.
function Countdown({ seconds, remainingMs, onTimeUp }: { seconds: number; remainingMs: number; onTimeUp: () => void }) {
  const t = useT();
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
        {t('{time} left', { time: `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` })}
      </span>
    </div>
  );
}
