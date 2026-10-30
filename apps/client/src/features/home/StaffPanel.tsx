import { useEffect, useState } from 'react';
import type { StaffMember, UpdateTeacher } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, ConfirmButton, ErrorNote, Field, Panel, useAction } from '../../ui/ui';

// Spec 4.1: the Super Admin adds, edits and deletes teachers.
export function StaffPanel() {
  const { call } = useApp();
  const [staff, setStaff] = useState<StaffMember[]>([]);
  const [form, setForm] = useState({ username: '', displayName: '', password: '' });

  const load = useAction(async () => setStaff(await call('GET /api/v1/staff')));
  useEffect(() => { void load.run(); }, []);

  const add = useAction(async () => {
    await call('POST /api/v1/staff', { body: form });
    setForm({ username: '', displayName: '', password: '' });
    await load.run();
  });

  const update = useAction(async (id: string, body: UpdateTeacher) => {
    await call('PATCH /api/v1/staff/:id', { params: { id }, body });
    await load.run();
  });

  const remove = useAction(async (id: string) => {
    await call('DELETE /api/v1/staff/:id', { params: { id } });
    await load.run();
  });

  const ready = form.username.trim() && form.displayName.trim() && form.password.length >= 8;

  return (
    <Panel title="Teachers">
      <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); void add.run(); }}>
        <Field id="staff-username" className="w-44" label="Username" autoComplete="off" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} />
        <Field id="staff-name" className="w-56" label="Name" value={form.displayName} onChange={(e) => setForm({ ...form, displayName: e.target.value })} />
        <Field id="staff-password" className="w-48" label="Starting password (8+)" type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <Button type="submit" disabled={!ready || add.busy}>Add teacher</Button>
      </form>

      <ul className="grid gap-2">
        {staff.map((s) => (
          <StaffRow key={s.id} member={s} onUpdate={(body) => update.run(s.id, body)} onRemove={() => remove.run(s.id)} />
        ))}
      </ul>
      <ErrorNote message={load.error ?? add.error ?? update.error ?? remove.error} />
    </Panel>
  );
}

function StaffRow({ member: s, onUpdate, onRemove }: { member: StaffMember; onUpdate: (body: UpdateTeacher) => void; onRemove: () => void }) {
  const { call } = useApp();
  const [mode, setMode] = useState<'view' | 'rename' | 'password'>('view');
  const [name, setName] = useState(s.displayName);
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);

  const reset = useAction(async () => {
    await call('PUT /api/v1/staff/:id/password', { params: { id: s.id }, body: { password } });
    setPassword('');
    setMode('view');
    setDone(true);
  });

  const disabled = s.status === 'disabled';

  return (
    <li className="grid gap-3 rounded-xl border border-border px-3 py-2">
      <div className="flex flex-wrap items-center gap-3">
        <span className="flex size-9 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary">{s.displayName.charAt(0).toUpperCase()}</span>
        <span className={disabled ? 'flex-1 text-muted-foreground line-through' : 'flex-1 font-medium'}>
          {s.displayName} <span className="ml-1 text-xs font-normal text-muted-foreground">@{s.username}</span>
          {s.role === 'super_admin' && <span className="ml-2 text-xs font-semibold text-role-admin">Super Admin</span>}
          {done && <span className="ml-2 text-xs font-normal text-success">Password changed</span>}
        </span>
        {s.role === 'teacher' && (
          <>
            <Toggle label="Can host lessons" checked={s.canHostLessons} onChange={(v) => onUpdate({ canHostLessons: v })} />
            <Toggle label="Can upload content" checked={s.canUploadContent} onChange={(v) => onUpdate({ canUploadContent: v })} />
            <Button variant="quiet" onClick={() => onUpdate({ status: disabled ? 'active' : 'disabled' })}>{disabled ? 'Enable' : 'Disable'}</Button>
            <Button variant="quiet" onClick={() => setMode(mode === 'rename' ? 'view' : 'rename')}>Rename</Button>
            <Button variant="quiet" onClick={() => { setMode(mode === 'password' ? 'view' : 'password'); setDone(false); }}>Reset password</Button>
            <ConfirmButton question={`Delete ${s.displayName}?`} onConfirm={onRemove}>Delete</ConfirmButton>
          </>
        )}
      </div>
      {mode === 'rename' && (
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); onUpdate({ displayName: name }); setMode('view'); }}>
          <Field id={`name-${s.id}`} className="w-56" label="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <Button type="submit" disabled={!name.trim()}>Save</Button>
        </form>
      )}
      {mode === 'password' && (
        <form className="flex flex-wrap items-end gap-3" onSubmit={(e) => { e.preventDefault(); void reset.run(); }}>
          <Field id={`pw-${s.id}`} className="w-56" label="New password (8+)" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <Button type="submit" disabled={password.length < 8 || reset.busy}>Save</Button>
          <ErrorNote message={reset.error} />
        </form>
      )}
    </li>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
      <input type="checkbox" className="size-4 accent-[var(--primary)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}
