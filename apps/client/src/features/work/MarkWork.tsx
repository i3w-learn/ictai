import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { AssignmentDetail, StudentAnswer } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, Card, ErrorNote, Field, useAction } from '../../ui/ui';
import { dayShort } from './work';

// One piece of work: every student of the class in roll order, their newest answer, and a place to
// give marks and a comment.
export function MarkWork({ id, onBack }: { id: string; onBack: () => void }) {
  const { call } = useApp();
  const [detail, setDetail] = useState<AssignmentDetail | null>(null);
  const load = useAction(async () => setDetail(await call('GET /api/v1/assignments/:id', { params: { id } })));
  useEffect(() => { void load.run(); }, [id]);

  if (!detail) return <div className="mx-auto grid max-w-4xl gap-4"><div><Button variant="quiet" onClick={onBack}><ArrowLeft className="size-4" /> Back</Button></div><ErrorNote message={load.error} /></div>;
  const a = detail.assignment;
  return (
    <div className="mx-auto grid max-w-4xl gap-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="quiet" onClick={onBack}><ArrowLeft className="size-4" /> Back</Button>
        <h1 className="flex-1 font-display text-2xl font-semibold">{a.title} <span className="text-base font-normal text-muted-foreground">· Class {a.className}{a.sectionName ? ` ${a.sectionName}` : ''}</span></h1>
        <span className="text-sm text-muted-foreground tabular-nums">{a.handedIn} of {a.students} handed in · {a.marked} marked</span>
      </div>
      {a.instructions && <Card className="p-4"><p className="text-sm whitespace-pre-wrap text-muted-foreground">{a.instructions}</p></Card>}
      {detail.answers.length === 0 && <p className="rounded-2xl border border-dashed border-border p-8 text-center text-muted-foreground">No students in this class yet.</p>}
      <ul className="grid gap-3">
        {detail.answers.map((s) => <AnswerRow key={s.studentId} workId={id} maxMarks={a.maxMarks} row={s} onMarked={setDetail} />)}
      </ul>
    </div>
  );
}

function AnswerRow({ workId, maxMarks, row, onMarked }: { workId: string; maxMarks: number; row: StudentAnswer; onMarked: (d: AssignmentDetail) => void }) {
  const { call } = useApp();
  const [marks, setMarks] = useState(row.mark ? String(row.mark.marks) : '');
  const [comment, setComment] = useState(row.mark?.comment ?? '');
  const n = Number(marks);
  const ok = marks !== '' && Number.isInteger(n) && n >= 0 && n <= maxMarks;
  const save = useAction(async () => onMarked(await call('PUT /api/v1/assignments/:id/marks/:studentId', { params: { id: workId, studentId: row.studentId }, body: { marks: n, comment } })));
  const changed = !row.mark || row.mark.marks !== n || row.mark.comment !== comment.trim();

  return (
    <li className="grid gap-3 rounded-xl border border-border bg-card px-4 py-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-semibold">{row.name}</span>
        {row.rollNo && <span className="text-xs text-muted-foreground">Roll {row.rollNo}</span>}
        {row.answer?.late && <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">Late</span>}
        {row.tries > 1 && <span className="text-xs text-muted-foreground">handed in {row.tries} times; this is the newest</span>}
        {row.mark && <span className="rounded-full bg-success/10 px-2 py-0.5 text-xs font-semibold text-success">Marked {row.mark.marks} / {maxMarks}</span>}
      </div>
      {!row.answer ? (
        <p className="text-sm text-muted-foreground">Not handed in yet.</p>
      ) : (
        <>
          <p className="rounded-lg bg-secondary px-3 py-2 whitespace-pre-wrap">{row.answer.body}</p>
          <span className="text-xs text-muted-foreground">Handed in {dayShort(row.answer.submittedAt)}</span>
          <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); if (ok) void save.run(); }}>
            <Field id={`marks-${row.studentId}`} className="w-28" label={`Marks (out of ${maxMarks})`} inputMode="numeric" value={marks} onChange={(e) => setMarks(e.target.value.replace(/\D/g, ''))} />
            <Field id={`comment-${row.studentId}`} className="min-w-64 flex-1" label="Comment for the student (optional)" maxLength={500} value={comment} onChange={(e) => setComment(e.target.value)} />
            <Button type="submit" disabled={!ok || !changed || save.busy}>{row.mark ? 'Change marks' : 'Give marks'}</Button>
          </form>
          <ErrorNote message={save.error} />
        </>
      )}
    </li>
  );
}
