import { useEffect, useState } from 'react';
import { ClipboardPen, Dumbbell, MessageCircleQuestion, Play, Plus, Sparkles } from 'lucide-react';
import { TEAM_COUNTS, type OpenRun, type QuizSummary, type SchoolClass } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { ApiCallError } from '../../core/api-client';
import { Button, ConfirmButton, ErrorNote, Panel, Select, useAction } from '../../ui/ui';

// The teacher's quizzes, filtered by class, with Lab Mode one click away.
export function QuizzesPanel({ onEdit, onLab, onAi, onAsk, onPlan, refresh }: { refresh: number; onEdit: (quizId: string | null) => void; onLab: (runId: string) => void; onAi: () => void; onAsk: () => void; onPlan: () => void }) {
  const { call, state } = useApp();
  const can = (p: 'lesson.start' | 'ai.teacher') => state.session?.principal.kind === 'staff' && state.session.principal.permissions.includes(p);
  const canHost = can('lesson.start');
  // The Super Admin can switch AI off for the school; the buttons then go away instead of leading to a refusal.
  const [aiOn, setAiOn] = useState(true);
  const mayAi = can('ai.teacher');
  const canAi = mayAi && aiOn;
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [classId, setClassId] = useState('');
  const [quizzes, setQuizzes] = useState<QuizSummary[]>([]);
  // How many teams the next Lab Mode run of each quiz is played in (0 = everyone for themselves).
  const [teams, setTeams] = useState<Record<string, OpenRun['teams']>>({});

  const load = useAction(async () => {
    const [cls, list] = await Promise.all([
      call('GET /api/v1/classes'),
      call('GET /api/v1/quizzes', { query: classId ? { classId } : {} }),
    ]);
    setClasses(cls);
    setQuizzes(list);
    if (mayAi) setAiOn((await call('GET /api/v1/ai/status').catch(() => null))?.enabled ?? true);
  });
  const { run: loadNow } = load;
  useEffect(() => { void loadNow(); }, [loadNow, classId, refresh]);

  // If this quiz is already open (say, from another console), go back to that run.
  // Lab Mode (everyone together, on a clock, alone or in teams) or practice (each student in their own time).
  const startLab = useAction(async (quizId: string, mode: OpenRun['mode'] = 'live') => {
    try {
      onLab((await call('POST /api/v1/quiz-runs', { body: { quizId, mode, teams: mode === 'live' ? teams[quizId] ?? 0 : 0 } })).runId);
    } catch (e) {
      if (!(e instanceof ApiCallError && e.code === 'QUIZ_RUNNING')) throw e;
      const open = (await call('GET /api/v1/quiz-runs', { query: { quizId } })).find((r) => r.status !== 'ended');
      if (!open) throw e;
      onLab(open.id);
    }
  });

  const remove = useAction(async (quizId: string) => {
    await call('DELETE /api/v1/quizzes/:id', { params: { id: quizId } });
    await load.run();
  });

  const className = (id: string) => classes.find((c) => c.id === id)?.name ?? '?';

  return (
    <Panel title="Quizzes" actions={
      <div className="flex flex-wrap justify-end gap-2">
        {canAi && <Button variant="quiet" onClick={onAsk}><MessageCircleQuestion className="size-4" /> Ask AI</Button>}
        {canAi && <Button variant="quiet" onClick={onPlan}><ClipboardPen className="size-4" /> Plan a lesson</Button>}
        {canAi && <Button variant="quiet" onClick={onAi}><Sparkles className="size-4" /> Make quiz with AI</Button>}
        <Button onClick={() => onEdit(null)}><Plus className="size-4" strokeWidth={2.25} /> New quiz</Button>
      </div>
    }>
      <Select aria-label="Class" value={classId} onChange={(e) => setClassId(e.target.value)}>
        <option value="">All classes</option>
        {classes.map((c) => <option key={c.id} value={c.id}>Class {c.name}</option>)}
      </Select>

      {quizzes.length === 0 ? (
        <p className="rounded-3xl border border-dashed border-border p-10 text-center text-muted-foreground">
          No quizzes yet. Click <b className="text-foreground">New quiz</b> to write one.
        </p>
      ) : (
        <ul className="grid gap-2">
          {quizzes.map((q) => (
            <li key={q.id} className="flex flex-wrap items-center gap-3 rounded-2xl border border-border px-3 py-2">
              <span className="min-w-48 flex-1">
                <span className="font-medium">{q.title}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {[`Class ${className(q.classId)}`, q.subject, `${q.questionCount} questions`, `${q.totalMarks} marks`].filter(Boolean).join(' · ')}
                </span>
              </span>
              {/* A quiz that is open is not started again: the row says so and leads back to it. */}
              {q.open && (
                <>
                  <span className="rounded-full bg-success/10 px-3 py-1 text-sm font-semibold text-success">{q.open.mode === 'practice' ? 'Practice is open' : 'Lab Mode is open'}</span>
                  <Button onClick={() => onLab(q.open!.runId)}>See it</Button>
                </>
              )}
              {!q.open && q.lastPracticeRunId && <Button variant="quiet" title="The tries and best scores of the last practice" onClick={() => onLab(q.lastPracticeRunId!)}>Practice scores</Button>}
              {canHost && !q.open && (
                <>
                  <Select aria-label={`Teams for ${q.title}`} className="min-w-32" value={teams[q.id] ?? 0} onChange={(e) => setTeams({ ...teams, [q.id]: Number(e.target.value) as OpenRun['teams'] })}>
                    <option value={0}>No teams</option>
                    {TEAM_COUNTS.map((n) => <option key={n} value={n}>{n} teams</option>)}
                  </Select>
                  <Button disabled={startLab.busy} onClick={() => startLab.run(q.id)}><Play className="size-4" strokeWidth={2.25} /> Start Lab Mode</Button>
                  <Button variant="quiet" disabled={startLab.busy} title="Students do it in their own time, with no clock, as often as they like. Not used for report cards." onClick={() => startLab.run(q.id, 'practice')}><Dumbbell className="size-4" /> Give as practice</Button>
                </>
              )}
              <Button variant="quiet" onClick={() => onEdit(q.id)}>Edit</Button>
              <ConfirmButton question={`Delete "${q.title}"?`} onConfirm={() => void remove.run(q.id)}>Delete</ConfirmButton>
            </li>
          ))}
        </ul>
      )}
      <ErrorNote message={load.error ?? startLab.error ?? remove.error} />
    </Panel>
  );
}
