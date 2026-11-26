import { useEffect, useRef, useState } from 'react';
import type { ImportResult, SchoolClass, Section, Student } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, ConfirmButton, ErrorNote, Field, Note, Panel, Select, useAction } from '../../ui/ui';
import { useT } from '../../i18n/i18n';
import { toImportRows } from './import';
import { StudentRow } from './StudentRow';

// Classes, sections and students, managed by teachers.
// onChanged: other panels (results, report cards, teachers' classes) list what is changed here.
export function StudentsPanel({ onChanged }: { onChanged: () => void }) {
  const { call, state } = useApp();
  const t = useT();
  // Only the Super Admin (or a teacher with no classes set) adds classes.
  const p = state.session?.principal;
  const limited = p?.kind === 'staff' && p.classIds != null;
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [classId, setClassId] = useState<string>('');
  const [sections, setSections] = useState<Section[]>([]);
  const [students, setStudents] = useState<Student[]>([]);
  const [newClass, setNewClass] = useState('');
  const [newSection, setNewSection] = useState('');
  const [form, setForm] = useState({ name: '', rollNo: '', sectionId: '' });
  const [promoteTo, setPromoteTo] = useState('');
  const [promoted, setPromoted] = useState<string | null>(null);
  const [imported, setImported] = useState<(ImportResult & { firstLine: number }) | null>(null);
  const filePicker = useRef<HTMLInputElement>(null);
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

  const { run: loadClassesNow } = loadClasses;

  useEffect(() => { void loadClassesNow(); }, [loadClassesNow]);
  const { run: loadClassNow } = loadClass;
  useEffect(() => { void loadClassNow(classId); }, [loadClassNow, classId]);
  // Another class: what was said about the last one (moved, imported) no longer applies.
  const pickClass = (id: string) => { setClassId(id); setPromoted(null); setPromoteTo(''); setImported(null); };

  const addClass = useAction(async () => {
    const c = await call('POST /api/v1/classes', { body: { name: newClass } });
    setNewClass('');
    await loadClasses.run();
    pickClass(c.id);
    onChanged();
  });

  const addSection = useAction(async () => {
    await call('POST /api/v1/sections', { body: { classId, name: newSection } });
    setNewSection('');
    await loadClass.run(classId);
    onChanged();
  });

  const addStudent = useAction(async () => {
    await call('POST /api/v1/students', {
      body: {
        name: form.name,
        classId,
        sectionId: form.sectionId || null,
        rollNo: form.rollNo.trim() || null,
      },
    });
    setForm({ name: '', rollNo: '', sectionId: form.sectionId });
    await loadClass.run(classId);
    onChanged();
  });

  // Reads a class list saved from Excel as CSV and adds every good row.
  const importFile = useAction(async (file: File) => {
    setImported(null);
    const read = toImportRows(await file.text(), t);
    if ('problem' in read) throw new Error(read.problem);
    const result = await call('POST /api/v1/classes/:id/students/import', { params: { id: classId }, body: { rows: read.rows } });
    setImported({ ...result, firstLine: read.firstLine });
    await loadClass.run(classId);
    onChanged();
  });

  const promote = useAction(async () => {
    const to = classes.find((c) => c.id === promoteTo)!;
    const { moved } = await call('POST /api/v1/classes/:id/promote', { params: { id: classId }, body: { toClassId: to.id } });
    const said = { n: moved, from: className, to: to.name };
    setPromoted(moved === 1 ? t('Moved {n} student from Class {from} to Class {to}.', said) : t('Moved {n} students from Class {from} to Class {to}.', said));
    setPromoteTo('');
    await loadClass.run(classId);
    onChanged();
  });

  // One line under the panel says what went wrong. It is wiped before each new thing the teacher
  // does, so an old problem (say, from adding a class) is never read as the answer to the new one.
  const fresh = () => [addClass, addSection, addStudent, importFile, promote].forEach((a) => a.clear());

  return (
    <Panel title={t('Students')}>
      <div className="flex flex-wrap items-end gap-3">
        <Select aria-label={t('Class')} value={classId} onChange={(e) => pickClass(e.target.value)}>
          <option value="">{t('Choose a class')}</option>
          {classes.map((c) => <option key={c.id} value={c.id}>{t('Class {name}', { name: c.name })}</option>)}
        </Select>
        {!limited && (
          <form className="flex items-end gap-3" onSubmit={(e) => { e.preventDefault(); fresh(); void addClass.run(); }}>
            <Field id="new-class" className="w-32" label={t('New class')} placeholder="7" value={newClass} onChange={(e) => setNewClass(e.target.value)} />
            <Button type="submit" variant="quiet" disabled={!newClass.trim()}>{t('Add class')}</Button>
          </form>
        )}
        {classId && (
          <form className="flex items-end gap-3" onSubmit={(e) => { e.preventDefault(); fresh(); void addSection.run(); }}>
            <Field id="new-section" className="w-32" label={t('New section')} placeholder="A" value={newSection} onChange={(e) => setNewSection(e.target.value)} />
            <Button type="submit" variant="quiet" disabled={!newSection.trim()}>{t('Add section')}</Button>
          </form>
        )}
      </div>

      {classId && (
        <>
          <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); fresh(); void addStudent.run(); }}>
            <Field id="student-name" className="w-64" label={t('Student name')} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
            <Field id="student-roll" className="w-28" label={t('Roll no')} value={form.rollNo} onChange={(e) => setForm({ ...form, rollNo: e.target.value })} />
            {sections.length > 0 && (
              <Select aria-label={t('Section')} value={form.sectionId} onChange={(e) => setForm({ ...form, sectionId: e.target.value })}>
                <option value="">{t('No section')}</option>
                {sections.map((x) => <option key={x.id} value={x.id}>{t('Section {name}', { name: x.name })}</option>)}
              </Select>
            )}
            <Button type="submit" disabled={!form.name.trim()}>{t('Add student')}</Button>
            <input
              ref={filePicker} type="file" accept=".csv,text/csv" className="hidden" aria-label={t('Class list file')}
              onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ''; if (f) { fresh(); void importFile.run(f); } }}
            />
            <Button type="button" variant="quiet" disabled={importFile.busy} onClick={() => filePicker.current?.click()}>{t('Add from a file')}</Button>
          </form>
          <p className="text-xs text-muted-foreground">
            {t('A file from Excel: use Save as → CSV. Columns: Name, Roll no, Section (roll no and section may be empty).')}
          </p>
          {imported && (
            <Note>
              {imported.added === 1 ? t('Added {n} student.', { n: imported.added }) : t('Added {n} students.', { n: imported.added })}
              {imported.skipped.length > 0 && <> {t('Left out {n}:', { n: imported.skipped.length })}</>}
              {imported.skipped.length > 0 && (
                <ul className="mt-1 list-disc pl-5">
                  {imported.skipped.map((s) => <li key={s.row}>{s.name ? t('Line {line} ({name}): {reason}', { line: s.row + imported.firstLine - 1, name: s.name, reason: s.reason }) : t('Line {line}: {reason}', { line: s.row + imported.firstLine - 1, reason: s.reason })}</li>)}
                </ul>
              )}
            </Note>
          )}
          {students.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 rounded-xl bg-secondary px-3 py-2">
              <span className="text-sm font-medium text-secondary-foreground">{t('Whole class')}</span>
              <span className="flex-1" />
              <Select aria-label={t('Move all to class')} value={promoteTo} onChange={(e) => setPromoteTo(e.target.value)}>
                <option value="">{t('Move all to class…')}</option>
                {classes.filter((c) => c.id !== classId).map((c) => <option key={c.id} value={c.id}>{t('Class {name}', { name: c.name })}</option>)}
              </Select>
              {promoteTo && (
                <ConfirmButton
                  question={t('Move all {n} to Class {name}?', { n: students.length, name: classes.find((c) => c.id === promoteTo)?.name ?? '' })}
                  onConfirm={() => { fresh(); void promote.run(); }}
                >
                  {t('Move')}
                </ConfirmButton>
              )}
            </div>
          )}
          {promoted && <Note>{promoted} {t("Promote the top class first (8 → 9 before 7 → 8) so classes don't mix.")}</Note>}
          <ul className="grid gap-2">
            {students.map((s) => (
              <StudentRow key={s.id} student={s} className={className} sections={sections} onChanged={async () => { await loadClass.run(classId); onChanged(); }} />
            ))}
          </ul>
        </>
      )}
      <ErrorNote message={loadClasses.error ?? loadClass.error ?? addClass.error ?? addSection.error ?? addStudent.error ?? importFile.error ?? promote.error} />
    </Panel>
  );
}
