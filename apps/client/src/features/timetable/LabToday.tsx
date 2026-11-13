import { useEffect, useState } from 'react';
import type { StudentToday } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { clockOf, labNow } from './timetable';

// PRD student "Today": the student's current lab period. One line under the greeting: in a period now,
// or when the next one is. Says nothing on a day with no lab, so the screen stays calm.
export function LabToday() {
  const { call } = useApp();
  const [today, setToday] = useState<StudentToday | null>(null);
  const [clock, setClock] = useState(() => clockOf(new Date()));
  useEffect(() => {
    let alive = true;
    call('GET /api/v1/timetable/today').then((t) => { if (alive) setToday(t); }, () => undefined);
    // The line follows the clock, so it changes when the bell rings without asking the server again.
    const t = setInterval(() => setClock(clockOf(new Date())), 20_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (!today || today.periods.length === 0) return null;
  const { now, next } = labNow(today.periods, clock);
  const what = (p: StudentToday['periods'][number]) => `${p.periodName}${p.subject ? ` · ${p.subject}` : ''}`;
  return (
    <p className="rounded-xl border border-border bg-card px-4 py-3 text-lg" aria-live="polite">
      {now ? <><b>Your lab period now:</b> {what(now)} <span className="text-muted-foreground tabular-nums">until {now.end}</span></>
        : next ? <><b>Your next lab period:</b> {what(next)} <span className="text-muted-foreground tabular-nums">at {next.start}</span></>
        : <span className="text-muted-foreground">Your lab periods for today are over.</span>}
    </p>
  );
}
