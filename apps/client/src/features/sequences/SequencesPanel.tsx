import { useEffect, useState } from 'react';
import { ArrowDown, ArrowUp, ListOrdered, X } from 'lucide-react';
import { MAX_STEPS, type Assignment, type ContentItem, type SchoolClass, type Sequence, type SequenceType, type StepKind } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, ConfirmButton, ErrorNote, Field, Panel, Select, cn, useAction } from '../../ui/ui';
import { SubjectField } from '../quizzes/SubjectField';

type Draft = { kind: StepKind; refId: string; title: string };
const WORDS: Record<SequenceType, string> = { playlist: 'Playlist', path: 'Learning path' };

// PRD "Playlists" and "Learning paths": an ordered list of steps for one class. A playlist holds
// library items; a learning path can also hold pieces of work and shows who has finished it.
// Students find both under Things to do.
export function SequencesPanel({ refresh }: { refresh: number }) {
  const { call } = useApp();
  const [list, setList] = useState<Sequence[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [library, setLibrary] = useState<ContentItem[]>([]);
  const [work, setWork] = useState<Assignment[]>([]);
  const [form, setForm] = useState({ type: 'playlist' as SequenceType, title: '', classId: '', subject: '' });
  const [steps, setSteps] = useState<Draft[]>([]);
  const [pick, setPick] = useState('');

  const load = useAction(async () => {
    const [s, c, lib, w] = await Promise.all([call('GET /api/v1/sequences'), call('GET /api/v1/classes'), call('GET /api/v1/content', { query: {} }), call('GET /api/v1/assignments')]);
    setList(s); setClasses(c); setLibrary(lib); setWork(w);
  });
  useEffect(() => { void load.run(); }, [refresh]);

  // What can be added as a step: this class's library, and for a path its work too.
  const choices: Draft[] = [
    ...library.filter((i) => i.classId === form.classId).map((i) => ({ kind: 'content' as const, refId: i.id, title: i.title })),
    ...(form.type === 'path' ? work.filter((a) => a.classId === form.classId).map((a) => ({ kind: 'work' as const, refId: a.id, title: `Work: ${a.title}` })) : []),
  ];
  const addStep = () => {
    const found = choices.find((c) => `${c.kind}:${c.refId}` === pick);
    if (found) setSteps([...steps, found]);
    setPick('');
  };
  const move = (i: number, by: number) => {
    const next = [...steps];
    const [s] = next.splice(i, 1);
    next.splice(i + by, 0, s!);
    setSteps(next);
  };
  // Changing the class empties the steps: they came from the old class. Switching to a playlist drops work steps.
  const setClass = (classId: string) => { setForm({ ...form, classId }); setSteps([]); setPick(''); };
  const setType = (type: SequenceType) => { setForm({ ...form, type }); if (type === 'playlist') setSteps(steps.filter((s) => s.kind === 'content')); setPick(''); };

  const problem = !form.title.trim() ? 'Type a title.' : !form.classId ? 'Pick a class.' : steps.length === 0 ? 'Add at least one step.' : null;
  const save = useAction(async () => {
    await call('POST /api/v1/sequences', { body: { type: form.type, title: form.title, classId: form.classId, subject: form.subject || null, steps: steps.map(({ kind, refId }) => ({ kind, refId })) } });
    setForm({ ...form, title: '' });
    setSteps([]);
    await load.run();
  });
  const remove = useAction(async (id: string) => {
    await call('DELETE /api/v1/sequences/:id', { params: { id } });
    await load.run();
  });

  return (
    <Panel title="Playlists and learning paths">
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (!problem) void save.run(); }}>
        <div className="flex flex-wrap items-end gap-3">
          <div className="grid gap-1.5" role="radiogroup" aria-label="Kind">
            <span className="text-[13px] font-medium text-muted-foreground">Kind</span>
            <div className="flex gap-1 rounded-xl border border-border p-1">
              {(['playlist', 'path'] as const).map((t) => (
                <button key={t} type="button" role="radio" aria-checked={form.type === t} onClick={() => setType(t)} className={cn('cursor-pointer rounded-lg px-3 py-1.5 text-sm font-semibold', form.type === t ? 'bg-primary text-primary-foreground' : 'text-muted-foreground')}>{WORDS[t]}</button>
              ))}
            </div>
          </div>
          <Field id="seq-title" className="w-64" label="Title" placeholder="Fractions week" maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <label className="grid gap-1.5">
            <span className="text-[13px] font-medium text-muted-foreground">Class</span>
            <Select aria-label="Playlist class" value={form.classId} onChange={(e) => setClass(e.target.value)}>
              <option value="">Choose a class</option>
              {classes.map((c) => <option key={c.id} value={c.id}>Class {c.name}</option>)}
            </Select>
          </label>
          <SubjectField id="seq-subject" placeholder="Maths" value={form.subject} onChange={(subject) => setForm({ ...form, subject })} />
        </div>
        <p className="text-sm text-muted-foreground">{form.type === 'playlist' ? 'A playlist is library items to go through in order.' : 'A learning path can mix library items and pieces of work. You see how many students have finished it.'}</p>

        {form.classId && (
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1.5">
              <span className="text-[13px] font-medium text-muted-foreground">Add a step</span>
              <Select aria-label="Step to add" className="min-w-72" value={pick} onChange={(e) => setPick(e.target.value)}>
                <option value="">{choices.length ? 'Choose from the library' + (form.type === 'path' ? ' or the work' : '') : 'Nothing in this class\'s library yet'}</option>
                {choices.map((c) => <option key={`${c.kind}:${c.refId}`} value={`${c.kind}:${c.refId}`}>{c.title}</option>)}
              </Select>
            </label>
            <Button type="button" variant="quiet" disabled={!pick || steps.length >= MAX_STEPS} onClick={addStep}>Add step</Button>
          </div>
        )}
        {steps.length > 0 && (
          <ol className="grid gap-1.5">
            {steps.map((s, i) => (
              <li key={i} className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5">
                <span className="w-6 text-sm text-muted-foreground tabular-nums">{i + 1}.</span>
                <span className="flex-1">{s.title}</span>
                <Button type="button" variant="quiet" aria-label={`Move step ${i + 1} up`} disabled={i === 0} onClick={() => move(i, -1)}><ArrowUp className="size-4" /></Button>
                <Button type="button" variant="quiet" aria-label={`Move step ${i + 1} down`} disabled={i === steps.length - 1} onClick={() => move(i, 1)}><ArrowDown className="size-4" /></Button>
                <Button type="button" variant="quiet" aria-label={`Remove step ${i + 1}`} onClick={() => setSteps(steps.filter((_, k) => k !== i))}><X className="size-4" /></Button>
              </li>
            ))}
          </ol>
        )}
        <div className="flex flex-wrap items-center gap-3">
          <Button type="submit" disabled={!!problem || save.busy}><ListOrdered className="size-4" /> Save {WORDS[form.type].toLowerCase()}</Button>
          <span className="text-sm text-muted-foreground">{(form.title || form.classId) && problem}</span>
        </div>
        <ErrorNote message={save.error} />
      </form>

      {list.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-8 text-center text-muted-foreground">None yet. Add things to the Library first, then put them in order here.</p>
      ) : (
        <ul className="grid gap-2">
          {list.map((q) => (
            <li key={q.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-border px-3 py-2.5">
              <span className="min-w-56 flex-1">
                <span className="font-medium">{q.title}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{[WORDS[q.type], `Class ${q.className}`, q.subject, `${q.steps.length} ${q.steps.length === 1 ? 'step' : 'steps'}`].filter(Boolean).join(' · ')}</span>
                <span className="mt-0.5 block text-xs text-muted-foreground">{q.steps.map((s, i) => `${i + 1}. ${s.title}`).join('   ')}</span>
              </span>
              {q.type === 'path' && <span className="text-sm text-muted-foreground tabular-nums">{q.finished} of {q.students} finished</span>}
              <ConfirmButton question={`Remove "${q.title}"?`} onConfirm={() => void remove.run(q.id)}>Remove</ConfirmButton>
            </li>
          ))}
        </ul>
      )}
      <ErrorNote message={load.error ?? remove.error} />
    </Panel>
  );
}
