import { useEffect, useState } from 'react';
import type { SchoolClass, Student } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, ErrorNote, Field, Note, Panel, Select, useAction } from '../../ui/ui';

// Just enough student setup to sign students in (M1). Full management comes later.
export function StudentsPanel() {
  const { call } = useApp();
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [classId, setClassId] = useState<string>('');
  const [students, setStudents] = useState<Student[]>([]);
  const [newClass, setNewClass] = useState('');
  const [name, setName] = useState('');
  const [pin, setPin] = useState('');
  const [issued, setIssued] = useState<{ name: string; code: string } | null>(null);

  const loadClasses = useAction(async () => setClasses(await call('GET /api/v1/classes')));
  const loadStudents = useAction(async (id: string) => setStudents(id ? await call('GET /api/v1/students', { query: { classId: id } }) : []));

  useEffect(() => { void loadClasses.run(); }, []);
  useEffect(() => { void loadStudents.run(classId); }, [classId]);

  const addClass = useAction(async () => {
    const c = await call('POST /api/v1/classes', { body: { name: newClass } });
    setNewClass('');
    await loadClasses.run();
    setClassId(c.id);
  });

  const addStudent = useAction(async () => {
    await call('POST /api/v1/students', { body: { name, classId, ...(pin ? { pin } : {}) } });
    setName('');
    setPin('');
    await loadStudents.run(classId);
  });

  const issueCode = useAction(async (s: Student) => {
    const { code } = await call('POST /api/v1/students/:id/enrolment-code', { params: { id: s.id } });
    setIssued({ name: s.name, code });
  });

  return (
    <Panel title="Students">
      <div className="flex flex-wrap items-end gap-3">
        <Select aria-label="Class" value={classId} onChange={(e) => setClassId(e.target.value)}>
          <option value="">Choose a class</option>
          {classes.map((c) => <option key={c.id} value={c.id}>Class {c.name}</option>)}
        </Select>
        <form className="flex items-end gap-3" onSubmit={(e) => { e.preventDefault(); void addClass.run(); }}>
          <Field id="new-class" className="w-40" label="New class" placeholder="7" value={newClass} onChange={(e) => setNewClass(e.target.value)} />
          <Button type="submit" variant="quiet" disabled={!newClass.trim()}>Add class</Button>
        </form>
      </div>

      {classId && (
        <>
          <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); void addStudent.run(); }}>
            <Field id="student-name" className="w-64" label="Student name" value={name} onChange={(e) => setName(e.target.value)} />
            <Field id="student-pin" className="w-40" label="PIN (optional)" inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
            <Button type="submit" disabled={!name.trim() || (pin.length > 0 && pin.length !== 4)}>Add student</Button>
          </form>
          {issued && <Note>First sign-in code for {issued.name}: <b className="font-mono text-base text-primary">{issued.code}</b></Note>}
          <ul className="grid gap-2">
            {students.map((s) => (
              <li key={s.id} className="flex items-center gap-3 rounded-xl border border-border px-3 py-2">
                <span className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">{s.name.charAt(0).toUpperCase()}</span>
                <span className="flex-1 font-medium">
                  {s.name} {!s.hasPin && <span className="ml-1 text-xs font-normal text-muted-foreground">No PIN yet</span>}
                </span>
                <Button variant="quiet" onClick={() => issueCode.run(s)}>First sign-in code</Button>
              </li>
            ))}
          </ul>
        </>
      )}
      <ErrorNote message={loadClasses.error ?? loadStudents.error ?? addClass.error ?? addStudent.error ?? issueCode.error} />
    </Panel>
  );
}
