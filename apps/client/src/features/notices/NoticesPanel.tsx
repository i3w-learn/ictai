import { useEffect, useState } from 'react';
import { Megaphone, Pin } from 'lucide-react';
import type { Notice, SchoolClass, Section } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, ConfirmButton, ErrorNote, Field, Panel, Select, useAction } from '../../ui/ui';
import { endOfDay, whoFor, whenShort } from './notices';

const BLANK = { title: '', body: '', classId: '', sectionId: '', pinned: false, until: '' };

// PRD "Notices": staff put up one-way messages for the whole school, a class or a section.
export function NoticesPanel({ refresh }: { refresh: number }) {
  const { call, state } = useApp();
  const p = state.session?.principal;
  // A teacher limited to some classes cannot write for the whole school.
  const limited = p?.kind === 'staff' && p.classIds != null;
  const [notices, setNotices] = useState<Notice[]>([]);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [form, setForm] = useState(BLANK);

  const load = useAction(async () => {
    const [n, c] = await Promise.all([call('GET /api/v1/notices'), call('GET /api/v1/classes')]);
    setNotices(n);
    setClasses(c);
  });
  useEffect(() => { void load.run(); }, [refresh]);

  // The sections offered follow the class picked.
  useEffect(() => {
    setSections([]);
    if (!form.classId) return;
    let current = true;
    call('GET /api/v1/sections', { query: { classId: form.classId } }).then((s) => { if (current) setSections(s); }, () => undefined);
    return () => { current = false; };
  }, [form.classId]);

  const problem = !form.title.trim() ? 'Type a title.' : limited && !form.classId ? 'Pick a class.' : null;

  const add = useAction(async () => {
    await call('POST /api/v1/notices', {
      body: {
        title: form.title, body: form.body, classId: form.classId || null, sectionId: form.sectionId || null,
        pinned: form.pinned, expiresAt: form.until ? endOfDay(form.until) : null,
      },
    });
    setForm(BLANK);
    await load.run();
  });

  const setPinned = useAction(async (n: Notice, pinned: boolean) => {
    await call('PUT /api/v1/notices/:id', {
      params: { id: n.id },
      body: { title: n.title, body: n.body, classId: n.classId, sectionId: n.sectionId, pinned, expiresAt: n.expiresAt },
    });
    await load.run();
  });

  const remove = useAction(async (id: string) => {
    await call('DELETE /api/v1/notices/:id', { params: { id } });
    await load.run();
  });

  // School-wide notices are shown to a limited teacher, but only the Super Admin changes them.
  const mayChange = (n: Notice) => !(limited && n.classId === null);

  return (
    <Panel title="Notices">
      <form className="grid gap-3" onSubmit={(e) => { e.preventDefault(); if (!problem) void add.run(); }}>
        <div className="flex flex-wrap items-end gap-3">
          <Field id="notice-title" className="w-72" label="Title" placeholder="Holiday on Friday" maxLength={120} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
          <label className="grid gap-1.5">
            <span className="text-[13px] font-medium text-muted-foreground">For</span>
            <Select aria-label="Notice for" value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value, sectionId: '' })}>
              {limited ? <option value="">Choose a class</option> : <option value="">Whole school</option>}
              {classes.map((c) => <option key={c.id} value={c.id}>Class {c.name}</option>)}
            </Select>
          </label>
          {sections.length > 0 && (
            <label className="grid gap-1.5">
              <span className="text-[13px] font-medium text-muted-foreground">Section</span>
              <Select aria-label="Notice section" className="min-w-32" value={form.sectionId} onChange={(e) => setForm({ ...form, sectionId: e.target.value })}>
                <option value="">All sections</option>
                {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </Select>
            </label>
          )}
          <Field id="notice-until" className="w-44" label="Show until (optional)" type="date" value={form.until} onChange={(e) => setForm({ ...form, until: e.target.value })} />
        </div>
        <label className="grid gap-1.5" htmlFor="notice-body">
          <span className="text-[13px] font-medium text-muted-foreground">Message (optional)</span>
          <textarea
            id="notice-body" rows={2} maxLength={2000}
            className="w-full resize-y rounded-xl border border-border bg-card px-3 py-2.5 text-[15px] text-foreground placeholder:text-muted-foreground/60"
            value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })}
          />
        </label>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input id="notice-pinned" type="checkbox" className="size-4 accent-[var(--primary)]" checked={form.pinned} onChange={(e) => setForm({ ...form, pinned: e.target.checked })} />
            Keep on top (pin)
          </label>
          <Button type="submit" disabled={!!problem || add.busy}><Megaphone className="size-4" /> Put up notice</Button>
          <span className="text-sm text-muted-foreground">{problem}</span>
        </div>
        <ErrorNote message={add.error} />
      </form>

      {notices.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border p-8 text-center text-muted-foreground">No notices yet. Students see a notice on their home screen as soon as you put it up.</p>
      ) : (
        <ul className="grid gap-2">
          {notices.map((n) => (
            <li key={n.id} className="flex flex-wrap items-start gap-3 rounded-xl border border-border px-3 py-2.5">
              <span className="min-w-56 flex-1">
                <span className="font-medium">{n.title}</span>
                {n.pinned && <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary"><Pin className="size-3" /> Pinned</span>}
                {n.expired && <span className="ml-2 rounded-full bg-secondary px-2 py-0.5 text-xs font-semibold text-muted-foreground">Expired: students no longer see it</span>}
                {n.body && <span className="mt-0.5 block text-sm whitespace-pre-wrap text-muted-foreground">{n.body}</span>}
                <span className="mt-1 block text-xs text-muted-foreground">
                  {[whoFor(n), `by ${n.byName}`, whenShort(n.createdAt), n.expiresAt && !n.expired ? `shows until ${whenShort(n.expiresAt)}` : null].filter(Boolean).join(' · ')}
                </span>
              </span>
              {mayChange(n) && (
                <>
                  <Button variant="quiet" disabled={setPinned.busy} onClick={() => setPinned.run(n, !n.pinned)}>{n.pinned ? 'Unpin' : 'Pin'}</Button>
                  <ConfirmButton question={`Take down "${n.title}"?`} onConfirm={() => void remove.run(n.id)}>Take down</ConfirmButton>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <ErrorNote message={load.error ?? setPinned.error ?? remove.error} />
    </Panel>
  );
}
