import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { StudentResults } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, Card, ErrorNote, PageTitle, Panel, useAction } from '../../ui/ui';
import { BAND_DOT } from './ResultsPanel';
import { bandOf } from './band';

const day = (ms: number) => new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

function Bar({ percent }: { percent: number }) {
  return (
    <span className="h-2 flex-1 rounded-full bg-secondary">
      <span className={`block h-2 rounded-full ${BAND_DOT[bandOf(percent)]}`} style={{ width: `${percent}%` }} />
    </span>
  );
}

// Spec 4.4: one student's quiz results, by subject and quiz by quiz.
export function StudentResultsPage({ studentId, onBack }: { studentId: string; onBack: () => void }) {
  const { call } = useApp();
  const [data, setData] = useState<StudentResults | null>(null);
  const load = useAction(async () => setData(await call('GET /api/v1/results/students/:id', { params: { id: studentId } })));
  useEffect(() => { void load.run(); }, [studentId]);

  const s = data?.student;
  return (
    <div className="mx-auto grid max-w-4xl gap-6">
      <div><Button variant="quiet" onClick={onBack}><ArrowLeft className="size-4" /> Back</Button></div>
      <ErrorNote message={load.error} />
      {data && s && (
        <>
          <PageTitle eyebrow={`Class ${s.className}${s.sectionName ? ` ${s.sectionName}` : ''}${s.rollNo ? ` · Roll ${s.rollNo}` : ''}`}>{s.name}</PageTitle>
          <div className="grid grid-cols-3 gap-3">
            {[
              ['Quizzes taken', String(data.attempts)],
              ['Average', data.average == null ? '—' : `${data.average}%`],
              ['Grade', data.grade ?? '—'],
            ].map(([label, value]) => (
              <Card key={label} className="px-5 py-4">
                <p className="text-sm text-muted-foreground">{label}</p>
                <p className="font-display text-3xl font-semibold tabular-nums">{value}</p>
              </Card>
            ))}
          </div>

          {data.attempts === 0 ? (
            <p className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">No quizzes taken yet.</p>
          ) : (
            <>
              <Panel title="By subject">
                <ul className="grid gap-3">
                  {data.subjects.map((sub) => (
                    <li key={sub.subject} className="flex items-center gap-3 text-sm">
                      <span className="w-36 truncate font-medium">{sub.subject}</span>
                      <Bar percent={sub.average} />
                      <span className="w-12 text-right tabular-nums">{sub.average}%</span>
                      <span className="w-8 font-semibold">{sub.grade}</span>
                      <span className="w-20 text-muted-foreground">{sub.attempts} {sub.attempts === 1 ? 'quiz' : 'quizzes'}</span>
                    </li>
                  ))}
                </ul>
              </Panel>
              <Panel title="Quiz history">
                <ul className="grid text-sm">
                  {data.history.map((h) => (
                    <li key={h.runId} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border py-2 last:border-0">
                      <span className="w-28 text-muted-foreground tabular-nums">{day(h.at)}</span>
                      <span className="min-w-40 flex-1">{h.quizTitle}{h.subject && <span className="text-muted-foreground"> · {h.subject}</span>}</span>
                      <span className="tabular-nums">{h.score}/{h.totalMarks}</span>
                      <span className="w-12 text-right font-semibold tabular-nums">{h.percent}%</span>
                    </li>
                  ))}
                </ul>
              </Panel>
            </>
          )}
        </>
      )}
    </div>
  );
}
