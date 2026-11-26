import { useEffect } from 'react';
import { ArrowLeft, Check, Trophy } from 'lucide-react';
import { quizRoom, type TeacherRunState } from '@ict/contracts';
import { useApp, useLiveState } from '../../app/app-context';
import { Button, ConfirmButton, ErrorNote, Panel, cn, useAction } from '../../ui/ui';
import { tk, useT } from '../../i18n/i18n';
import { placeOf, teamLook } from './teams';

const STATUS = { lobby: tk('Waiting to start'), active: tk('Live'), ended: tk('Ended') } as const;

// Lab Mode for the teacher (v2's LabSession): code, who joined, live progress, leaderboard.
export function LabSession({ runId, onExit }: { runId: string; onExit: () => void }) {
  const { call } = useApp();
  const t = useT();
  const read = () => call('GET /api/v1/quiz-runs/:id', { params: { id: runId } });
  const [run, setFirst, liveError] = useLiveState<TeacherRunState>(quizRoom(runId), null, read);

  // REST gives the first picture even before the relay is up; after that the relay keeps it fresh.
  const load = useAction(async () => setFirst(await read()));
  const { run: loadNow } = load;
  useEffect(() => { void loadNow(); }, [loadNow, runId]);

  const start = useAction(async () => setFirst(await call('POST /api/v1/quiz-runs/:id/start', { params: { id: runId } })));
  const end = useAction(async () => setFirst(await call('POST /api/v1/quiz-runs/:id/end', { params: { id: runId } })));

  if (!run) return <ErrorNote message={load.error} />;
  const done = run.participants.filter((p) => p.finished).length;
  const practice = run.mode === 'practice';
  const inTeams = run.participants.some((p) => p.team != null);
  const teamChip = (team: number | null) => team != null && (
    <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', teamLook(team).chip)}>{t(teamLook(team).name)}</span>
  );
  // Each sentence is translated whole; the name of the page or button in the middle is shown in bold.
  const [practiceBefore, practiceAfter] = t('Class {name} finds this quiz under {page}. There is no clock, and they can try as often as they like. The scores are not used for report cards.', { name: run.className }).split('{page}');
  const [liveBefore, liveAfter] = t('Class {name} sees this quiz on their screens now. They press {button}; there is no code.', { name: run.className }).split('{button}');

  return (
    <div className="mx-auto grid max-w-5xl gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="quiet" onClick={onExit}><ArrowLeft className="size-4" /> {t('Quizzes')}</Button>
        <h1 className="flex-1 font-display text-2xl font-semibold">{run.title} <span className="text-base font-normal text-muted-foreground">· {t('Class {name}', { name: run.className })}</span></h1>
        <span className={run.status === 'active' ? 'rounded-full bg-success/10 px-3 py-1 text-sm font-semibold text-success' : 'rounded-full bg-secondary px-3 py-1 text-sm font-semibold text-secondary-foreground'}>
          {practice && run.status === 'active' ? t('Practice') : t(STATUS[run.status])}
        </span>
      </div>

      {run.status !== 'ended' && (
        <div className="grid justify-items-center gap-2 rounded-2xl border-2 border-dashed border-primary/40 bg-primary/5 p-8 text-center">
          {practice
            ? <span className="text-sm text-muted-foreground">{practiceBefore}<b>{t('Things to do')}</b>{practiceAfter}</span>
            : <span className="text-sm text-muted-foreground">{liveBefore}<b>{t('Join the quiz')}</b>{liveAfter}</span>}
          <strong className="font-display text-5xl font-semibold text-primary">{practice ? t('{n} started', { n: run.participants.length }) : t('{n} joined', { n: run.participants.length })}</strong>
          <span className="text-sm text-muted-foreground">{t('{n} questions', { n: run.questionCount })} · {t('{n} marks', { n: run.totalMarks })}</span>
        </div>
      )}

      <div className="flex flex-wrap gap-3">
        {run.status === 'lobby' && <Button disabled={start.busy} onClick={() => start.run()}>{t('Start quiz')}</Button>}
        {run.status !== 'ended' && <ConfirmButton question={practice ? t('End this practice? Students can no longer do it.') : t('End the quiz for everyone?')} onConfirm={() => void end.run()}>{practice ? t('End practice') : t('End quiz')}</ConfirmButton>}
        {run.status === 'active' && !practice && <span className="self-center text-sm text-muted-foreground">{t('{done} of {total} finished', { done, total: run.participants.length })}</span>}
      </div>
      <ErrorNote message={liveError ?? start.error ?? end.error} />

      {run.teams.length > 0 && run.status !== 'lobby' && (
        <Panel title={run.status === 'ended' ? t('Teams · final places') : t('Teams')}>
          <p className="text-sm text-muted-foreground">{t("A team's score is the average of its members' scores, so a team with one more student gets no head start.")}</p>
          <ol className="grid gap-2 sm:grid-cols-2">
            {run.teams.map((tm, i) => (
              <li key={tm.team} className="flex items-center gap-3 rounded-2xl border border-border px-4 py-3">
                {/* Teams that are level share a place, and the trophy. */}
                <span className="w-6 tabular-nums text-muted-foreground">{run.status === 'ended' && tm.score > 0 && tm.score === run.teams[0]!.score ? <Trophy className="size-4 text-primary" /> : placeOf(run.teams, i)}</span>
                <span className={cn('size-3 rounded-full', teamLook(tm.team).dot)} />
                <span className="flex-1 font-semibold">{t(teamLook(tm.team).name)}</span>
                <span className="text-sm text-muted-foreground">{tm.members === 1 ? t('{n} student', { n: tm.members }) : t('{n} students', { n: tm.members })}</span>
                <span className="font-semibold tabular-nums">{tm.score} / {run.totalMarks}</span>
              </li>
            ))}
          </ol>
        </Panel>
      )}

      {run.status === 'lobby' && !practice ? (
        <Panel title={t('Students joined · {n}', { n: run.participants.length })}>
          {run.participants.length === 0 ? (
            <p className="text-muted-foreground">{t('Nobody yet. Names appear here as students join.')}</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {run.participants.map((p) => <span key={p.studentId} className={cn('rounded-full px-3 py-1 text-sm font-medium', p.team != null ? teamLook(p.team).chip : 'bg-primary/10 text-primary')}>{p.name}{p.team != null && ` · ${t(teamLook(p.team).name)}`}</span>)}
            </div>
          )}
        </Panel>
      ) : (
        <Panel title={practice ? t('Practice so far') : run.status === 'ended' ? t('Leaderboard') : t('Live progress')}>
          {practice && run.participants.length === 0 && <p className="text-muted-foreground">{t('Nobody has started yet.')}</p>}
          <table className={cn('w-full text-sm', practice && run.participants.length === 0 && 'hidden')}>
            <thead>
              <tr className="border-b border-border text-left text-[0.6875rem] tracking-[0.14em] text-muted-foreground uppercase">
                <th className="w-10 py-2.5 pr-3 font-semibold">#</th>
                <th className="py-2.5 pr-3 font-semibold">{t('Student')}</th>
                {inTeams && <th className="py-2.5 pr-3 font-semibold">{t('Team')}</th>}
                {practice ? <>
                  <th className="py-2.5 pr-3 font-semibold">{t('Tries')}</th>
                  <th className="py-2.5 pr-3 font-semibold">{t('Best score')}</th>
                  <th className="py-2.5 font-semibold">{t('This try')}</th>
                </> : <>
                  <th className="py-2.5 pr-3 font-semibold">{t('Answered')}</th>
                  <th className="py-2.5 pr-3 font-semibold">{t('Correct')}</th>
                  <th className="py-2.5 pr-3 font-semibold">{t('Score')}</th>
                  <th className="py-2.5 font-semibold">{t('Done')}</th>
                </>}
              </tr>
            </thead>
            <tbody>
              {run.participants.map((p, i) => (
                <tr key={p.studentId} className="border-b border-border last:border-0">
                  <td className="py-3 pr-3 tabular-nums text-muted-foreground">{!practice && run.status === 'ended' && p.score > 0 && p.score === run.participants[0]!.score ? <Trophy className="size-4 text-primary" /> : i + 1}</td>
                  <td className="py-3 pr-3 font-medium">{p.name}</td>
                  {inTeams && <td className="py-3 pr-3">{teamChip(p.team)}</td>}
                  {practice ? <>
                    <td className="py-3 pr-3 tabular-nums">{p.tries}</td>
                    <td className="py-3 pr-3 font-semibold tabular-nums">{p.best == null ? t('Not finished yet') : `${p.best} / ${run.totalMarks}`}</td>
                    <td className="py-3 tabular-nums text-muted-foreground">{p.finished ? t('Finished') : t('{n} of {total} answered', { n: p.answered, total: run.questionCount })}</td>
                  </> : <>
                    <td className="py-3 pr-3 tabular-nums">{p.answered} / {run.questionCount}</td>
                    <td className="py-3 pr-3 tabular-nums">{p.correct}</td>
                    <td className="py-3 pr-3 font-semibold tabular-nums">{p.score} / {run.totalMarks}</td>
                    <td className="py-3">{p.finished && <Check className="size-4 text-success" />}</td>
                  </>}
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </div>
  );
}
