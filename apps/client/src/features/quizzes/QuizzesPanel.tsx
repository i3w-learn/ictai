import { useEffect, useState } from 'react';
import { MessageCircleQuestion, Play, Plus, Sparkles } from 'lucide-react';
import type { QuizSummary, SchoolClass } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { ApiCallError } from '../../core/api-client';
import { Button, ConfirmButton, ErrorNote, Panel, Select, useAction } from '../../ui/ui';

// The teacher's quizzes, filtered by class, with Lab Mode one click away.
export function QuizzesPanel({ onEdit, onLab, onAi, onAsk }: { onEdit: (quizId: string | null) => void; onLab: (runId: string) => void; onAi: () => void; onAsk: () => void }) {
  const { call, state } = useApp();
  const can = (p: 'lesson.start' | 'ai.teacher') => state.session?.principal.kind === 'staff' && state.session.principal.permissions.includes(p);
  const canHost = can('lesson.start');
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [classId, setClassId] = useState('');
  const [quizzes, setQuizzes] = useState<QuizSummary[]>([]);

  const load = useAction(async () => {
    const [cls, list] = await Promise.all([
      call('GET /api/v1/classes'),
      call('GET /api/v1/quizzes', { query: classId ? { classId } : {} }),
    ]);
    setClasses(cls);
    setQuizzes(list);
  });
  useEffect(() => { void load.run(); }, [classId]);

  // If this quiz is already open (say, from another console), go back to that run.
  const startLab = useAction(async (quizId: string) => {
    try {
      onLab((await call('POST /api/v1/quiz-runs', { body: { quizId } })).runId);
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
      <div className="flex gap-2">
        {can('ai.teacher') && <Button variant="quiet" onClick={onAsk}><MessageCircleQuestion className="size-4" /> Ask AI</Button>}
        {can('ai.teacher') && <Button variant="quiet" onClick={onAi}><Sparkles className="size-4" /> Make quiz with AI</Button>}
        <Button onClick={() => onEdit(null)}><Plus className="size-4" strokeWidth={2.25} /> New quiz</Button>
      </div>
    }>
      <Select aria-label="Class" value={classId} onChange={(e) => setClassId(e.target.value)}>
        <option value="">All classes</option>
        {classes.map((c) => <option key={c.id} value={c.id}>Class {c.name}</option>)}
      </Select>

      {quizzes.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">
          No quizzes yet. Click <b className="text-foreground">New quiz</b> to write one.
        </p>
      ) : (
        <ul className="grid gap-2">
          {quizzes.map((q) => (
            <li key={q.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border px-3 py-2">
              <span className="min-w-48 flex-1">
                <span className="font-medium">{q.title}</span>
                <span className="ml-2 text-xs text-muted-foreground">
                  {[`Class ${className(q.classId)}`, q.subject, `${q.questionCount} questions`, `${q.totalMarks} marks`].filter(Boolean).join(' · ')}
                </span>
              </span>
              {canHost && (
                <Button disabled={startLab.busy} onClick={() => startLab.run(q.id)}><Play className="size-4" strokeWidth={2.25} /> Start Lab Mode</Button>
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
