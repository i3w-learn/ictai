import { useEffect, useState } from 'react';
import { Monitor } from 'lucide-react';
import type { StudentToday } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Empty } from '../../ui/dashboard';
import { Card, cn } from '../../ui/ui';
import { useT } from '../../i18n/i18n';
import { clockOf, labNow } from './timetable';


// PRD student "Today": the student's lab periods for today as a row of cards. The period that is on
// now (or, between periods, the next one) is the wide card; the others stand beside it as narrow ones.
export function LabToday() {
  const { call } = useApp();
  const t = useT();
  const [today, setToday] = useState<StudentToday | null>(null);
  const [clock, setClock] = useState(() => clockOf(new Date()));
  useEffect(() => {
    let alive = true;
    call('GET /api/v1/timetable/today').then((got) => { if (alive) setToday(got); }, () => undefined);
    // The cards follow the clock, so they change when the bell rings without asking the server again.
    const timer = setInterval(() => setClock(clockOf(new Date())), 20_000);
    return () => { alive = false; clearInterval(timer); };
  }, [call]);

  const periods = today?.periods ?? [];
  const { now, next } = labNow(periods, clock);
  const main = now ?? next;
  const wide = (
    <Card className="ui-tone-lilac flex h-44 min-w-56 flex-1 flex-col justify-between p-5" key="main">
      {main ? (
        <>
          <span className="self-start rounded-full bg-primary/10 px-3 py-1 text-sm font-semibold text-primary">{now ? t('Now') : t('Next')}</span>
          <span className="grid gap-1" aria-live="polite">
            <span className="font-display text-2xl leading-tight font-semibold">{main.periodName}</span>
            {main.subject && <span className="text-lg">{main.subject}</span>}
            <span className="text-muted-foreground tabular-nums">{now ? t('Your lab period now, until {time}', { time: main.end }) : t('Your next lab period, at {time}', { time: main.start })}</span>
          </span>
        </>
      ) : (
        <span className="my-auto text-lg text-muted-foreground" aria-live="polite">
          {t('Your lab periods for today are over.')}
        </span>
      )}
    </Card>
  );
  if (periods.length === 0) return today ? <Empty icon={Monitor}>{t('No lab periods for you today.')}</Empty> : null;
  return (
    // A row that scrolls sideways would cut off its cards' shadows. The padding gives them room,
    // and the same margin taken away keeps the row where it was.
    <div className="-mx-4 -mt-2 -mb-8 flex gap-3 overflow-x-auto px-4 pt-2 pb-10">
      {periods.map((p) => p === main ? wide : (
        <Card key={`${p.start} ${p.periodName}`} className={cn('flex h-44 w-[4.5rem] shrink-0 flex-col items-center justify-between gap-2 py-4', p.end <= clock && 'opacity-55')}>
          {/* Read from the bottom up, the period's name and its subject side by side. */}
          <span className="min-h-0 flex-1 rotate-180 text-sm [writing-mode:vertical-rl]">
            <span className="block truncate font-medium">{p.periodName}</span>
            {p.subject && <span className="block truncate text-muted-foreground">{p.subject}</span>}
          </span>
          <span className="text-xs text-muted-foreground tabular-nums">{p.start}</span>
        </Card>
      ))}
      {periods.length > 0 && !main && wide}
    </div>
  );
}
