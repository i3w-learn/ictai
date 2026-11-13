import type { Slot, StudentToday } from '@ict/contracts';

// "Class 7" or "Class 7 A".
export const slotLabel = (s: Pick<Slot, 'className' | 'sectionName'>) => `Class ${s.className}${s.sectionName ? ` ${s.sectionName}` : ''}`;

type LabPeriod = StudentToday['periods'][number];

// Where the student is in their lab day, from the clock time "HH:MM": in a period now, waiting for the
// next one, or done for today. Periods come in time order.
export function labNow(periods: LabPeriod[], clock: string): { now: LabPeriod | null; next: LabPeriod | null } {
  const now = periods.find((p) => p.start <= clock && clock < p.end) ?? null;
  const next = periods.find((p) => p.start > clock) ?? null;
  return { now, next };
}

export const clockOf = (date: Date) => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
