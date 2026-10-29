import { useState } from 'react';
import type { Section, Student } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, ConfirmButton, ErrorNote, Field, Note, Select, useAction } from '../../ui/ui';

type Mode = 'view' | 'edit' | 'pin';

// One student's line in the console, with its own edit, PIN, code and delete actions.
export function StudentRow({ student: s, sections, onChanged }: { student: Student; sections: Section[]; onChanged: () => Promise<void> }) {
  const { call } = useApp();
  const [mode, setMode] = useState<Mode>('view');
  const [edit, setEdit] = useState({ name: s.name, rollNo: s.rollNo ?? '', sectionId: s.sectionId ?? '' });
  const [pin, setPin] = useState('');
  const [code, setCode] = useState<string | null>(null);

  const save = useAction(async () => {
    await call('PATCH /api/v1/students/:id', {
      params: { id: s.id },
      body: { name: edit.name, rollNo: edit.rollNo.trim() || null, sectionId: edit.sectionId || null },
    });
    setMode('view');
    await onChanged();
  });

  const savePin = useAction(async () => {
    await call('PUT /api/v1/students/:id/pin', { params: { id: s.id }, body: { pin } });
    setPin('');
    setMode('view');
    await onChanged();
  });

  const issueCode = useAction(async () => {
    setCode((await call('POST /api/v1/students/:id/enrolment-code', { params: { id: s.id } })).code);
  });

  const remove = useAction(async () => {
    await call('DELETE /api/v1/students/:id', { params: { id: s.id } });
    await onChanged();
  });

  const section = sections.find((x) => x.id === s.sectionId)?.name;

  return (
    <li className="grid gap-3 rounded-xl border border-border px-3 py-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">{s.name.charAt(0).toUpperCase()}</span>
        <span className="flex-1 font-medium">
          {s.name}
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            {[s.rollNo && `Roll ${s.rollNo}`, section && `Section ${section}`, !s.hasPin && 'No PIN yet'].filter(Boolean).join(' · ')}
          </span>
        </span>
        <Button variant="quiet" onClick={() => setMode(mode === 'edit' ? 'view' : 'edit')}>Edit</Button>
        <Button variant="quiet" onClick={() => setMode(mode === 'pin' ? 'view' : 'pin')}>Reset PIN</Button>
        <Button variant="quiet" onClick={() => issueCode.run()}>First sign-in code</Button>
        <ConfirmButton question={`Delete ${s.name}?`} onConfirm={() => void remove.run()}>Delete</ConfirmButton>
      </div>

      {mode === 'edit' && (
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); void save.run(); }}>
          <Field id={`name-${s.id}`} className="w-64" label="Name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          <Field id={`roll-${s.id}`} className="w-28" label="Roll no" value={edit.rollNo} onChange={(e) => setEdit({ ...edit, rollNo: e.target.value })} />
          <Select aria-label="Section" value={edit.sectionId} onChange={(e) => setEdit({ ...edit, sectionId: e.target.value })}>
            <option value="">No section</option>
            {sections.map((x) => <option key={x.id} value={x.id}>Section {x.name}</option>)}
          </Select>
          <Button type="submit" disabled={!edit.name.trim() || save.busy}>Save</Button>
          <Button type="button" variant="quiet" onClick={() => setMode('view')}>Cancel</Button>
        </form>
      )}

      {mode === 'pin' && (
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); void savePin.run(); }}>
          <Field id={`pin-${s.id}`} className="w-40" label="New PIN" inputMode="numeric" maxLength={4} value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, ''))} />
          <Button type="submit" disabled={pin.length !== 4 || savePin.busy}>Save</Button>
        </form>
      )}

      {code && <Note>First sign-in code for {s.name}: <b className="font-mono text-base text-primary">{code}</b></Note>}
      <ErrorNote message={save.error ?? savePin.error ?? issueCode.error ?? remove.error} />
    </li>
  );
}
