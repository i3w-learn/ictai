import { useEffect, useState } from 'react';
import type { SchoolClass, Section, Student } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, ConfirmButton, ErrorNote, Field, Note, Panel, Select, useAction } from '../../ui/ui';
import { ClassSheet, type Sheet } from './ClassSheet';
import { StudentRow } from './StudentRow';

// Classes, sections and students, managed by teachers.
export function StudentsPanel() {
  const { call } = useApp();
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [classId, setClassId] = useState<string>('');
  const [sections, setSections] = useState<Section[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [newClass, setNewClass] = useState('');
  const [newSection, setNewSection] = useState('');
  const [form, setForm] = useState({ name: '', rollNo: '', sectionId: '', pin: '' });
  const [promoteTo, setPromoteTo] = useState('');
  const [promoted, setPromoted] = useState<string | null>(null);
  const [sheet, setSheet] = useState<Sheet | null>(null);
  const className = classes.find((c) => c.id === classId)?.name ?? '';

  const loadClasses = useAction(async () => setClasses(await call('GET /api/v1/classes')));
  const loadClass = useAction(async (id: string) => {
    if (!id) {
      setSections([]);
      setStudents([]);
      return;
    }
    const [secs, list] = await Promise.all([
      call('GET /api/v1/sections', { query: { classId: id } }),
      call('GET /api/v1/students', { query: { classId: id } }),
    ]);
    setSections(secs);
    setStudents(list);
  });

  useEffect(() => { void loadClasses.run(); }, []);
  useEffect(() => { void loadClass.run(classId); setPromoted(null); setPromoteTo(''); }, [classId]);

  const addClass = useAction(async () => {
    const c = await call('POST /api/v1/classes', { body: { name: newClass } });
    setNewClass('');
    await loadClasses.run();
    setClassId(c.id);
  });

  const addSection = useAction(async () => {
    await call('POST /api/v1/sections', { body: { classId, name: newSection } });
    setNewSection('');
    await loadClass.run(classId);
  });

  const addStudent = useAction(async () => {
    await call('POST /api/v1/students', {
      body: {
        name: form.name,
        classId,
        sectionId: form.sectionId || null,
        rollNo: form.rollNo.trim() || null,
        ...(form.pin ? { pin: form.pin } : {}),
      },
    });
    setForm({ name: '', rollNo: '', sectionId: form.sectionId, pin: '' });
    await loadClass.run(classId);
  });

  const makeCodes = useAction(async () => {
    setSheet({ kind: 'codes', className, rows: await call('POST /api/v1/classes/:id/enrolment-codes', { params: { id: classId } }) });
  });

  const makeCards = useAction(async () => {
    setSheet({ kind: 'cards', className, rows: await call('POST /api/v1/classes/:id/cards', { params: { id: classId } }) });
    await loadClass.run(classId);
  });

  const promote = useAction(async () => {
    const to = classes.find((c) => c.id === promoteTo)!;
    const { moved } = await call('POST /api/v1/classes/:id/promote', { params: { id: classId }, body: { toClassId: to.id } });
    setPromoted(`Moved ${moved} students from Class ${className} to Class ${to.name}.`);
    setPromoteTo('');
    await loadClass.run(classId);
  });

  return (
    <Panel title="Students">
      {sheet && <ClassSheet sheet={sheet} onClose={() => setSheet(null)} />}
      <div className="flex flex-wrap items-end gap-3">
        <Select aria-label="Class" value={classId} onChange={(e) => setClassId(e.target.value)}>
          <option value="">Choose a class</option>
          {classes.map((c) => <option key={c.id} value={c.id}>Class {c.name}</option>)}
        </Select>
        <form className="flex items-end gap-3" onSubmit={(e) => { e.preventDefault(); void addClass.run(); }}>
          <Field id="new-class" className="w-32" label="New class" placeholder="7" value={newClass} onChange={(e) => setNewClass(e.target.value)} />
          <Button type="submit" variant="quiet" disabled={!newClass.trim()}>Add class</Button>
        </form>
        {classId && (
          <form className="flex items-end gap-3" onSubmit={(e) => { e.preventDefault(); void addSection.run(); }}>
            <Field id="new-section" className="w-32" label="New section" placeholder="A" value={newSection} onChange={(e) => setNewSection(e.target.value)} />
            <Button type="submit" variant="quiet" disabled={!newSection.trim()}>Add section</Button>
          </form>
        )}
      </div>

      {classId && (
        <>
          <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); void addStudent.run(); }}>
            <Field id="student-name" className="w-64" label="Student name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Field id="student-roll" className="w-28" label="Roll no" value={form.rollNo} onChange={(e) => setForm({ ...form, rollNo: e.target.value })} />
            {sections.length > 0 && (
              <Select aria-label="Section" value={form.sectionId} onChange={(e) => setForm({ ...form, sectionId: e.target.value })}>
                <option value="">No section</option>
                {sections.map((x) => <option key={x.id} value={x.id}>Section {x.name}</option>)}
              </Select>
            )}
            <Field id="student-pin" className="w-36" label="PIN (optional)" inputMode="numeric" maxLength={4} value={form.pin} onChange={(e) => setForm({ ...form, pin: e.target.value.replace(/\D/g, '') })} />
            <Button type="submit" disabled={!form.name.trim() || (form.pin.length > 0 && form.pin.length !== 4)}>Add student</Button>
          </form>
          {students.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl bg-secondary px-3 py-2">
              <span className="text-sm font-medium text-secondary-foreground">Whole class</span>
              <Button variant="quiet" disabled={makeCodes.busy} onClick={() => makeCodes.run()}>First sign-in codes</Button>
              <ConfirmButton question="New cards stop old ones working. Go ahead?" onConfirm={() => void makeCards.run()}>Print sign-in cards</ConfirmButton>
              <span className="flex-1" />
              <Select aria-label="Move all to class" value={promoteTo} onChange={(e) => setPromoteTo(e.target.value)}>
                <option value="">Move all to class…</option>
                {classes.filter((c) => c.id !== classId).map((c) => <option key={c.id} value={c.id}>Class {c.name}</option>)}
              </Select>
              {promoteTo && (
                <ConfirmButton
                  question={`Move all ${students.length} to Class ${classes.find((c) => c.id === promoteTo)?.name}?`}
                  onConfirm={() => void promote.run()}
                >
                  Move
                </ConfirmButton>
              )}
            </div>
          )}
          {promoted && <Note>{promoted} Promote the top class first (8 → 9 before 7 → 8) so classes don't mix.</Note>}
          <ul className="grid gap-2">
            {students.map((s) => (
              <StudentRow key={s.id} student={s} sections={sections} onChanged={() => loadClass.run(classId)} />
            ))}
          </ul>
        </>
      )}
      <ErrorNote message={loadClasses.error ?? loadClass.error ?? addClass.error ?? addSection.error ?? addStudent.error ?? makeCodes.error ?? makeCards.error ?? promote.error} />
    </Panel>
  );
}
