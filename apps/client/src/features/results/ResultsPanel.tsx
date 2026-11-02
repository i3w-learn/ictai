import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import type { Band, ResultsOverview, SchoolClass } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, ErrorNote, Panel, Select, cn, useAction } from '../../ui/ui';
import { BAND_LABEL, downloadCsv, toCsv } from './csv';

export const BAND_DOT: Record<Band, string> = {
  great: 'bg-success',
  growing: 'bg-amber-500',
  needs: 'bg-destructive',
  none: 'bg-muted-foreground',
};
const BANDS: Band[] = ['great', 'growing', 'needs', 'none'];

// Spec 4.4: how each student is doing in quizzes. Students who need help are listed first.
export function ResultsPanel({ onStudent }: { onStudent: (studentId: string) => void }) {
  const { call } = useApp();
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [classId, setClassId] = useState('');
  const [data, setData] = useState<ResultsOverview | null>(null);

  const load = useAction(async () => {
    const [cls, overview] = await Promise.all([
      call('GET /api/v1/classes'),
      call('GET /api/v1/results/overview', { query: classId ? { classId } : {} }),
    ]);
    setClasses(cls);
    setData(overview);
  });
  useEffect(() => { void load.run(); }, [classId]);

  const download = () => {
    if (!data) return;
    const name = classId ? `class-${classes.find((c) => c.id === classId)?.name ?? ''}` : 'all';
    downloadCsv(`results-${name}-${new Date().toISOString().slice(0, 10)}.csv`, toCsv(data.students));
  };

  const needs = data?.students.filter((s) => s.band === 'needs') ?? [];

  return (
    <Panel
      title="How students are doing"
      actions={<Button variant="quiet" disabled={!data?.students.length} onClick={download}><Download className="size-4" /> Download for Excel</Button>}
    >
      <div className="flex flex-wrap items-center gap-3">
        <Select aria-label="Class" value={classId} onChange={(e) => setClassId(e.target.value)}>
          <option value="">All classes</option>
          {classes.map((c) => <option key={c.id} value={c.id}>Class {c.name}</option>)}
        </Select>
        {data && (
          <span className="text-muted-foreground">
            {data.classAverage == null ? 'No quizzes yet' : <>Average <b className="text-foreground">{data.classAverage}%</b></>}
          </span>
        )}
      </div>

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {BANDS.map((b) => (
              <div key={b} className="rounded-xl border border-border px-4 py-3">
                <p className="flex items-center gap-2 text-sm text-muted-foreground"><span className={cn('size-2.5 rounded-full', BAND_DOT[b])} />{BAND_LABEL[b]}</p>
                <p className="font-display text-2xl font-semibold tabular-nums">{data.counts[b]}</p>
              </div>
            ))}
          </div>

          <p className="text-sm">
            <b className="font-semibold">Needs you today: </b>
            {needs.length === 0 ? <span className="text-muted-foreground">Everyone on track</span> : needs.map((s, i) => (
              <span key={s.id}>{i > 0 && ', '}<button className="text-destructive underline-offset-2 hover:underline" onClick={() => onStudent(s.id)}>{s.name}</button></span>
            ))}
          </p>

          {data.students.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">No students yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-left text-muted-foreground">
                  <tr><th className="py-2 font-medium">Name</th><th className="font-medium">Roll</th><th className="font-medium">Class</th><th className="font-medium">Quizzes</th><th className="w-48 font-medium">Average</th></tr>
                </thead>
                <tbody>
                  {data.students.map((s) => (
                    <tr key={s.id} className="cursor-pointer border-t border-border hover:bg-secondary" onClick={() => onStudent(s.id)}>
                      <td className="py-2"><span className="flex items-center gap-2"><span className={cn('size-2.5 shrink-0 rounded-full', BAND_DOT[s.band])} title={BAND_LABEL[s.band]} />{s.name}</span></td>
                      <td className="tabular-nums">{s.rollNo ?? '—'}</td>
                      <td>{s.className}{s.sectionName ? ` ${s.sectionName}` : ''}</td>
                      <td className="tabular-nums">{s.attempts}</td>
                      <td>
                        {s.average == null ? <span className="text-muted-foreground">Not started</span> : (
                          <span className="flex items-center gap-2">
                            <span className="h-2 flex-1 rounded-full bg-secondary"><span className={cn('block h-2 rounded-full', BAND_DOT[s.band])} style={{ width: `${s.average}%` }} /></span>
                            <span className="w-10 text-right tabular-nums">{s.average}%</span>
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
      <ErrorNote message={load.error} />
    </Panel>
  );
}
