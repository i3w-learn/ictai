import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { MAX_PERIODS, overlappingPeriods, type Period, type SchoolSettings } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, ErrorNote, Field, Note, Panel, useAction } from '../../ui/ui';

// PRD "Settings" (Super Admin only): the school's name, the AI switch, and the periods of the school day.
export function SettingsPanel({ onSaved }: { onSaved: () => void }) {
  const { call } = useApp();
  const [saved, setSaved] = useState<SchoolSettings | null>(null);
  const [form, setForm] = useState<SchoolSettings | null>(null);
  const [done, setDone] = useState(false);

  const load = useAction(async () => {
    const s = await call('GET /api/v1/settings');
    setSaved(s);
    setForm(s);
  });
  useEffect(() => { void load.run(); }, []);

  const save = useAction(async () => {
    const s = await call('PUT /api/v1/settings', { body: form! });
    setSaved(s);
    setForm(s);
    setDone(true);
    onSaved();
  });

  if (!form || !saved) return <Panel title="Settings"><ErrorNote message={load.error} /></Panel>;

  const change = (patch: Partial<SchoolSettings>) => { setForm({ ...form, ...patch }); setDone(false); };
  const setPeriod = (i: number, patch: Partial<Period>) => change({ periods: form.periods.map((p, k) => (k === i ? { ...p, ...patch } : p)) });
  // Starts the new period where the last one ends, 40 minutes long, so the Super Admin mostly just clicks.
  const addPeriod = () => {
    const last = form.periods[form.periods.length - 1];
    const start = last?.end ?? '09:00';
    change({ periods: [...form.periods, { name: `Period ${form.periods.length + 1}`, start, end: plusMinutes(start, 40) }] });
  };

  const clash = overlappingPeriods(form.periods.filter((p) => p.start < p.end));
  const problem =
    !form.schoolName.trim() ? 'Type the school name.'
    : form.periods.some((p) => !p.name.trim()) ? 'Name every period.'
    : form.periods.some((p) => p.start >= p.end) ? 'Every period must end after it starts.'
    : clash ? `"${clash[0].name}" and "${clash[1].name}" overlap.`
    : null;
  const dirty = JSON.stringify(form) !== JSON.stringify(saved);

  return (
    <Panel title="Settings">
      <div className="flex flex-wrap items-end gap-6">
        <Field id="set-school" className="w-80" label="School name" maxLength={80} value={form.schoolName} onChange={(e) => change({ schoolName: e.target.value })} />
        <label htmlFor="set-ai" className="flex cursor-pointer items-center gap-2 pb-2.5 text-sm">
          <input id="set-ai" type="checkbox" className="size-4 accent-[var(--primary)]" checked={form.aiEnabled} onChange={(e) => change({ aiEnabled: e.target.checked })} />
          Teachers can use AI (Ask AI, Make quiz with AI)
        </label>
      </div>

      <div className="grid gap-2">
        <span className="text-[13px] font-medium text-muted-foreground">Periods of the school day</span>
        {form.periods.length === 0 && <p className="text-sm text-muted-foreground">No periods yet. Add the lab periods so the timetable can use them.</p>}
        {form.periods.map((p, i) => (
          <div key={i} className="flex flex-wrap items-end gap-3">
            <Field id={`period-${i}-name`} className="w-48" label={i === 0 ? 'Name' : `Period ${i + 1} name`} value={p.name} maxLength={40} onChange={(e) => setPeriod(i, { name: e.target.value })} />
            <Field id={`period-${i}-start`} className="w-32" label="Starts" type="time" value={p.start} onChange={(e) => setPeriod(i, { start: e.target.value })} />
            <Field id={`period-${i}-end`} className="w-32" label="Ends" type="time" value={p.end} onChange={(e) => setPeriod(i, { end: e.target.value })} />
            <Button type="button" variant="quiet" aria-label={`Remove ${p.name || `period ${i + 1}`}`} onClick={() => change({ periods: form.periods.filter((_, k) => k !== i) })}><Trash2 className="size-4" /></Button>
          </div>
        ))}
        <div><Button type="button" variant="quiet" disabled={form.periods.length >= MAX_PERIODS} onClick={addPeriod}><Plus className="size-4" /> Add period</Button></div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Button disabled={!!problem || !dirty || save.busy} onClick={() => save.run()}>Save settings</Button>
        <span className="text-sm text-muted-foreground">{problem ?? (dirty ? 'You have changes that are not saved.' : '')}</span>
      </div>
      {done && !dirty && <Note>Saved.</Note>}
      <ErrorNote message={save.error ?? load.error} />
    </Panel>
  );
}

// "09:00" + 40 -> "09:40". Stops at the end of the day rather than wrapping past midnight.
export function plusMinutes(clock: string, minutes: number): string {
  const [h, m] = clock.split(':').map(Number);
  const total = Math.min(h! * 60 + m! + minutes, 23 * 60 + 59);
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}
