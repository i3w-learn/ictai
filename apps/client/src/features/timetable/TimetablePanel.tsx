import { useEffect, useState } from 'react';
import { SCHOOL_DAYS, type Period, type SchoolClass, type Section, type Slot, type Timetable } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, ErrorNote, Field, Panel, Select, cn, useAction } from '../../ui/ui';
import { slotLabel } from './timetable';

type Cell = { day: number; period: Period };

// PRD "Timetable": the weekly lab grid. Rows are the periods (set in Settings), columns are Monday to
// Saturday. The school has one lab, so each box holds one class. Click a box to book or free it.
export function TimetablePanel({ refresh }: { refresh: number }) {
  const { call, state } = useApp();
  const p = state.session?.principal;
  const scope = p?.kind === 'staff' ? p.classIds : null;
  const [grid, setGrid] = useState<Timetable | null>(null);
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [sections, setSections] = useState<Section[]>([]);
  const [open, setOpen] = useState<Cell | null>(null);
  const [form, setForm] = useState({ classId: '', sectionId: '', subject: '' });

  const load = useAction(async () => {
    const [g, c] = await Promise.all([call('GET /api/v1/timetable'), call('GET /api/v1/classes')]);
    setGrid(g);
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

  const slotAt = (day: number, periodId: string) => grid?.slots.find((s) => s.day === day && s.periodId === periodId);
  // A teacher limited to some classes cannot change a box another class holds.
  const mine = (s: Slot | undefined) => !s || !scope || scope.includes(s.classId);

  const pick = (cell: Cell) => {
    const s = slotAt(cell.day, cell.period.id!);
    if (!mine(s)) return;
    setOpen(cell);
    setForm({ classId: s?.classId ?? '', sectionId: s?.sectionId ?? '', subject: s?.subject ?? '' });
  };

  const save = useAction(async () => {
    setGrid(await call('PUT /api/v1/timetable/slot', {
      body: { day: open!.day, periodId: open!.period.id!, classId: form.classId, sectionId: form.sectionId || null, subject: form.subject || null },
    }));
    setOpen(null);
  });
  const free = useAction(async () => {
    setGrid(await call('DELETE /api/v1/timetable/slot', { query: { day: open!.day, periodId: open!.period.id! } }));
    setOpen(null);
  });

  if (!grid) return <Panel title="Timetable"><ErrorNote message={load.error} /></Panel>;
  if (grid.periods.length === 0) {
    return (
      <Panel title="Timetable">
        <p className="rounded-2xl border border-dashed border-border p-8 text-center text-muted-foreground">
          No periods yet. The Super Admin adds the periods of the school day in <b className="text-foreground">Settings</b>; then the lab can be booked here.
        </p>
      </Panel>
    );
  }

  const booked = open && slotAt(open.day, open.period.id!);
  return (
    <Panel title="Timetable">
      <p className="text-sm text-muted-foreground">Who has the lab, period by period. Click a box to book it for a class or to free it. One class per box: the school has one lab.</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] border-separate border-spacing-1 text-sm">
          <thead>
            <tr>
              <th className="w-36 px-2 py-1 text-left text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">Period</th>
              {SCHOOL_DAYS.map((d) => <th key={d} className="px-2 py-1 text-left text-[11px] font-semibold tracking-[0.14em] text-muted-foreground uppercase">{d}</th>)}
            </tr>
          </thead>
          <tbody>
            {grid.periods.map((period) => (
              <tr key={period.id}>
                <th className="px-2 py-1 text-left align-top font-medium">
                  {period.name}
                  <span className="block text-xs font-normal text-muted-foreground tabular-nums">{period.start} to {period.end}</span>
                </th>
                {SCHOOL_DAYS.map((dayName, i) => {
                  const day = i + 1;
                  const s = slotAt(day, period.id!);
                  const isOpen = open?.day === day && open.period.id === period.id;
                  return (
                    <td key={day} className="align-top">
                      <button
                        type="button" disabled={!mine(s)} onClick={() => pick({ day, period })}
                        aria-label={`${dayName}, ${period.name}: ${s ? slotLabel(s) : 'free'}`}
                        className={cn(
                          'min-h-14 w-full cursor-pointer rounded-xl border px-2 py-1.5 text-left transition-colors disabled:cursor-not-allowed',
                          s ? 'border-primary/30 bg-primary/10' : 'border-dashed border-border text-muted-foreground hover:border-primary/50',
                          isOpen && 'ring-2 ring-primary',
                        )}
                      >
                        {s ? <><span className="block font-semibold">{slotLabel(s)}</span>{s.subject && <span className="text-xs text-muted-foreground">{s.subject}</span>}</> : 'Free'}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <form className="grid gap-3 rounded-2xl border border-border bg-secondary/50 p-4" onSubmit={(e) => { e.preventDefault(); if (form.classId) void save.run(); }}>
          <strong>{SCHOOL_DAYS[open.day - 1]} · {open.period.name} <span className="font-normal text-muted-foreground tabular-nums">({open.period.start} to {open.period.end})</span></strong>
          <div className="flex flex-wrap items-end gap-3">
            <label className="grid gap-1.5">
              <span className="text-[13px] font-medium text-muted-foreground">Class</span>
              <Select aria-label="Class with the lab" value={form.classId} onChange={(e) => setForm({ ...form, classId: e.target.value, sectionId: '' })}>
                <option value="">Choose a class</option>
                {classes.map((c) => <option key={c.id} value={c.id}>Class {c.name}</option>)}
              </Select>
            </label>
            {sections.length > 0 && (
              <label className="grid gap-1.5">
                <span className="text-[13px] font-medium text-muted-foreground">Section</span>
                <Select aria-label="Section with the lab" className="min-w-32" value={form.sectionId} onChange={(e) => setForm({ ...form, sectionId: e.target.value })}>
                  <option value="">All sections</option>
                  {sections.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </Select>
              </label>
            )}
            <Field id="slot-subject" className="w-48" label="Subject (optional)" placeholder="Maths" maxLength={60} value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
            <Button type="submit" disabled={!form.classId || save.busy}>{booked ? 'Change' : 'Book the lab'}</Button>
            {booked && <Button type="button" variant="quiet" disabled={free.busy} onClick={() => free.run()}>Free this period</Button>}
            <Button type="button" variant="quiet" onClick={() => setOpen(null)}>Cancel</Button>
          </div>
          <ErrorNote message={save.error ?? free.error} />
        </form>
      )}
      <ErrorNote message={load.error} />
    </Panel>
  );
}
