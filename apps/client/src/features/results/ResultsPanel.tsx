import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Download, Printer } from 'lucide-react';
import type { Band, ResultsOverview, SchoolClass, StudentResultRow } from '@ict/contracts';
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

// A plain page of the results table. The print window can send it to a printer or save it as a PDF.
function ResultsSheet({ title, rows, onClose }: { title: string; rows: StudentResultRow[]; onClose: () => void }) {
  return createPortal(
    <div className="print-sheet fixed inset-0 z-50 overflow-y-auto bg-card px-6 py-6 text-foreground">
      <div className="no-print mb-5 flex flex-wrap items-center gap-3">
        <h2 className="flex-1 font-display text-xl font-semibold">{title}</h2>
        <Button onClick={() => window.print()}>Print or save as PDF</Button>
        <Button variant="quiet" onClick={onClose}>Close</Button>
      </div>
      <h2 className="mb-1 hidden font-display text-xl font-semibold print:block">{title}</h2>
      <p className="mb-4 text-sm text-muted-foreground">{new Date().toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' })}</p>
      <table className="w-full text-left text-sm">
        <thead className="text-muted-foreground">
          <tr><th className="py-2 pr-4">Roll</th><th className="py-2 pr-4">Name</th><th className="py-2 pr-4">Class</th><th className="py-2 pr-4">Quizzes taken</th><th className="py-2 pr-4">Average</th><th className="py-2">Group</th></tr>
        </thead>
        <tbody>
          {rows.map((s) => (
            <tr key={s.id} className="break-inside-avoid border-t border-border">
              <td className="py-2 pr-4 tabular-nums">{s.rollNo ?? '–'}</td>
              <td className="py-2 pr-4 font-medium">{s.name}</td>
              <td className="py-2 pr-4">{s.className}{s.sectionName ? ` ${s.sectionName}` : ''}</td>
              <td className="py-2 pr-4 tabular-nums">{s.attempts}</td>
              <td className="py-2 pr-4 tabular-nums">{s.average == null ? '–' : `${s.average}%`}</td>
              <td className="py-2">{BAND_LABEL[s.band]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>,
    document.body,
  );
}

// Spec 4.4: how each student is doing in quizzes. Students who need help are listed first.
export function ResultsPanel({ onStudent }: { onStudent: (studentId: string) => void }) {
  const { call } = useApp();
  const [classes, setClasses] = useState<SchoolClass[]>([]);
  const [classId, setClassId] = useState('');
  const [data, setData] = useState<ResultsOverview | null>(null);
  const [printing, setPrinting] = useState(false);

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
      actions={
        <>
          <Button variant="quiet" disabled={!data?.students.length} onClick={() => setPrinting(true)}><Printer className="size-4" /> Print or PDF</Button>
          <Button variant="quiet" disabled={!data?.students.length} onClick={download}><Download className="size-4" /> Download for Excel</Button>
        </>
      }
    >
      {printing && data && (
        <ResultsSheet
          title={`Quiz results · ${classId ? `Class ${classes.find((c) => c.id === classId)?.name ?? ''}` : 'All classes'}`}
          rows={data.students}
          onClose={() => setPrinting(false)}
        />
      )}
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
