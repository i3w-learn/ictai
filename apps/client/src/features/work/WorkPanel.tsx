import { useEffect, useState } from 'react';
import { ClipboardList } from 'lucide-react';
import type { Assignment, SchoolClass, Section } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, ConfirmButton, ErrorNote, Field, Panel, Select, useAction } from '../../ui/ui';
import { SubjectField } from '../quizzes/SubjectField';
import { dayShort, endOfDay } from './work';

const BLANK = { title: '', instructions: '', classId: '', sectionId: '', subject: '', due: '', maxMarks: '10' };

// PRD "Work": set a piece of written work for a class, then open it to read answers and give marks.
export function WorkPanel({ onOpen, refresh, onChanged }: { onOpen: (id: string) => void; refresh: number; onChanged: () => void }) {
  const { call } = useApp();
  const [work, setWork] = useState<Assignment[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [form, setForm] = useState(BLANK);

  const load = useAction(async () => {
    const [w, c] = await Promise.all([call('GET /api/v1/assignments'), call('GET /api/v1/classes')]);
    setWork(w);
    setClasses(c);
  });
  useEffect(() => { void load.run(); }, [refresh]);

  useEffect(() => {
    setSections([]);
    if (!form.classId) return;
    let current = true;
    call('GET /api/v1/sections', { query: { classId: form.classId } }).then((s) => { if (current) setSections(s); }, () => undefined);
    return () => { current = false; };
  }, [form.classId]);

  const max = Number(form.maxMarks);
  const problem = !form.title.trim() ? 'Type a title.' : !form.classId ? 'Pick a class.' : !(Number.isInteger(max) && max >= 1 && max <= 100) ? 'Marks: 1 to 100.' : null;

  const add = useAction(async () => {
    await call('POST /api/v1/assignments', {
      body: {
        title: form.title, instructions: form.instructions, classId: form.classId, sectionId: form.sectionId || null,
        subject: form.subject || null, dueAt: form.due ? endOfDay(form.due) : null, maxMarks: max,
      },
    });
    setForm(BLANK);
    onChanged();
  });
  const remove = useAction(async (id: string) => {
    await call('DELETE /api/v1/assignments/:id', { params: { id } });
    onChanged();
  });

  return (
    <Panel title="Work">
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (!problem) void add.run(); }}>
        <div className="flex flex-wrap items-end gap-3">
          <Field id="work-title" className="w-72" label="Title" placeholder="Fractions worksheet" maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <label className="grid gap-1.5">
            <span className="text-[13px] font-medium text-muted-foreground">Class</span>
            <Select aria-label="Work for class" value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value, sectionId: '' })}>
              <option value="">Choose a class</option>
              {classes.map((c) => <option key={c.id} value={c.id}>Class {c.name}</option>)}
            </Select>
          </label>
          {sections.length > 0 && (
            <label className="grid gap-1.5">
              <span className="text-[13px] font-medium text-muted-foreground">Section</span>
              <Select aria-label="Work for section" className="min-w-32" value={form.sectionId} onChange={(e) => setForm({ ...form, sectionId: e.target.value })}>
                <option value="">All sections</option>
                {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </label>
          )}
          <SubjectField id="work-subject" placeholder="Maths" value={form.subject} onChange={(subject) => setForm({ ...form, subject })} />
          <Field id="work-due" className="w-44" label="Due (optional)" type="date" value={form.due} onChange={(e) => setForm({ ...form, due: e.target.value })} />
          <Field id="work-marks" className="w-24" label="Out of" inputMode="numeric" value={form.maxMarks} onChange={(e) => setForm({ ...form, maxMarks: e.target.value })} />
        </div>
        <label className="grid gap-1.5" htmlFor="work-instructions">
          <span className="text-[13px] font-medium text-muted-foreground">What should students do?</span>
          <textarea
            id="work-instructions" rows={3} maxLength={4000} placeholder="Answer these in your own words…"
            className="w-full resize-y rounded-xl border border-border bg-card px-3 py-2.5 text-[15px] text-foreground placeholder:text-muted-foreground/60"
            value={form.instructions} onChange={(e) => setForm({ ...form, instructions: e.target.value })}
          />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={!!problem || add.busy}><ClipboardList className="size-4" /> Set this work</Button>
          <span className="text-sm text-muted-foreground">{problem}</span>
        </div>
        <ErrorNote message={add.error} />
      </form>

      {work.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-8 text-center text-muted-foreground">No work set yet. Students see new work under My work and write their answer there.</p>
      ) : (
        <ul className="grid gap-2">
          {work.map((w) => (
            <li key={w.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border px-3 py-2.5">
              <span className="min-w-56 flex-1">
                <span className="font-medium">{w.title}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">
                  {[`Class ${w.className}${w.sectionName ? ` ${w.sectionName}` : ''}`, w.subject, w.dueAt ? `due ${dayShort(w.dueAt)}` : null, `out of ${w.maxMarks}`].filter(Boolean).join(' · ')}
                </span>
              </span>
              <span className="text-sm text-muted-foreground tabular-nums">{w.handedIn} of {w.students} handed in · {w.marked} marked</span>
              <Button onClick={() => onOpen(w.id)}>Read and mark</Button>
              <ConfirmButton question={`Take away "${w.title}"?`} onConfirm={() => void remove.run(w.id)}>Take away</ConfirmButton>
            </li>
          ))}
        </ul>
      )}
      <ErrorNote message={load.error ?? remove.error} />
    </Panel>
  );
}
