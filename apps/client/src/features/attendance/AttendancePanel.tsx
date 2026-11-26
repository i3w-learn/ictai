import { useEffect, useState } from 'react';
import type { AttendanceDay, AttendanceRow, SchoolClass } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, ErrorNote, Field, Panel, Select, cn, useAction } from '../../ui/ui';
import { useLang, type T } from '../../i18n/i18n';
import { rich } from '../home/audit-words';

const ASK_EVERY_MS = 10_000;

const timeOf = (at: number, locale: string | undefined) => new Date(at).toLocaleTimeString(locale, { hour: 'numeric', minute: '2-digit' });

// Why the student is marked the way they are, in a few words.
export function reason(r: AttendanceRow, t: T, locale: string | undefined): string {
  if (r.by === 'signin' && r.at != null) return t('Signed in at {time}', { time: timeOf(r.at, locale) });
  if (r.by === 'teacher') return t('Marked by a teacher');
  return t('Did not sign in');
}

// Spec 4.4 "Attendance": who of a class was in the lab on a day. Signing in on a lab PC marks a
// student present; a teacher can change it here.
export function AttendancePanel({ refresh, canEdit }: { refresh: number; canEdit: boolean }) {
  const { call } = useApp();
  const { t, locale } = useLang();
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [classId, setClassId] = useState('');
  // '' = today, as the server sees it.
  const [date, setDate] = useState('');
  const [data, setData] = useState<AttendanceDay | null>(null);

  const load = useAction(async () => {
    const cls = await call('GET /api/v1/classes');
    setClasses(cls);
    const id = cls.some((c) => c.id === classId) ? classId : (cls[0]?.id ?? '');
    if (id !== classId) setClassId(id);
    setData(id ? await call('GET /api/v1/attendance', { query: date ? { classId: id, date } : { classId: id } }) : null);
  });
  const { run: loadNow } = load;
  useEffect(() => { void loadNow(); }, [loadNow, classId, date, refresh]);

  const mark = useAction(async (r: AttendanceRow, present: boolean) => {
    if (!data) return;
    setData(await call('PUT /api/v1/attendance/:id', { params: { id: r.studentId }, body: { date: data.date, present } }));
  });

  // Today's list is asked for again every few seconds, so a student who signs in shows as present
  // without the teacher leaving the page. Not for a day gone by (nobody signs in there), and not while
  // a mark is being saved: an answer asked for before the save would put the old mark back.
  useEffect(() => {
    if (!classId || date || mark.busy) return;
    let alive = true;
    const timer = setInterval(() => void call('GET /api/v1/attendance', { query: { classId } }).then((d) => { if (alive) setData(d); }, () => undefined), ASK_EVERY_MS);
    return () => { alive = false; clearInterval(timer); };
  }, [call, classId, date, mark.busy]);

  const present = data?.rows.filter((r) => r.present).length ?? 0;

  return (
    <Panel title={t('Attendance')}>
      <div className="flex flex-wrap items-end gap-3">
        <label className="grid gap-1.5">
          <span className="text-[0.8125rem] font-medium text-muted-foreground">{t('Class')}</span>
          <Select aria-label={t('Attendance class')} value={classId} onChange={(e) => setClassId(e.target.value)}>
            {classes.length === 0 && <option value="">{t('No classes yet')}</option>}
            {classes.map((c) => <option key={c.id} value={c.id}>{t('Class {name}', { name: c.name })}</option>)}
          </Select>
        </label>
        <Field id="attendance-date" className="w-44" label={t('Day')} type="date" max={data?.today} value={date || data?.today || ''} onChange={(e) => setDate(e.target.value === data?.today ? '' : e.target.value)} />
        {data && data.rows.length > 0 && (
          <p className="pb-2.5 text-muted-foreground">{rich(t('{n} of {total} present'), { n: <b className="text-foreground">{present}</b>, total: data.rows.length })}</p>
        )}
      </div>

      {data && (data.rows.length === 0 ? (
        <p className="rounded-3xl border border-dashed border-border p-8 text-center text-muted-foreground">{t('No students in this class yet.')}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-muted-foreground">
              <tr><th className="py-2 font-medium">{t('Roll')}</th><th className="font-medium">{t('Name')}</th><th className="font-medium">{t('Section')}</th><th className="font-medium">{t('Status')}</th><th className="font-medium" /></tr>
            </thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={r.studentId} className="border-t border-border">
                  <td className="py-2 tabular-nums">{r.rollNo ?? '—'}</td>
                  <td className="font-medium">{r.name}</td>
                  <td>{r.sectionName ?? '—'}</td>
                  <td>
                    <span className={cn('rounded-full px-2.5 py-0.5 text-xs font-semibold', r.present ? 'bg-success/15 text-success' : 'bg-secondary text-muted-foreground')}>{r.present ? t('Present') : t('Absent')}</span>
                    <span className="ml-2 text-xs text-muted-foreground">{reason(r, t, locale)}</span>
                  </td>
                  <td className="py-1 text-right">
                    {canEdit && <Button variant="quiet" className="min-h-9" disabled={mark.busy} onClick={() => mark.run(r, !r.present)}>{r.present ? t('Mark absent') : t('Mark present')}</Button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}
      <ErrorNote message={load.error ?? mark.error} />
    </Panel>
  );
}
