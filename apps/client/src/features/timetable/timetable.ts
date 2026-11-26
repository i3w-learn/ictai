import type { SCHOOL_DAYS, Slot, StudentToday } from '@ict/contracts';
import { tk, type T } from '../../i18n/i18n';

// "Class 7" or "Class 7 A".
export const slotLabel = (s: Pick<Slot, 'className' | 'sectionName'>, t: T) =>
  s.sectionName ? t('Class {name} {section}', { name: s.className, section: s.sectionName }) : t('Class {name}', { name: s.className });

// The school days as the screens say them: t(DAY[day]).
export const DAY: Record<(typeof SCHOOL_DAYS)[number], string> = {
  Monday: tk('Monday'), Tuesday: tk('Tuesday'), Wednesday: tk('Wednesday'), Thursday: tk('Thursday'), Friday: tk('Friday'), Saturday: tk('Saturday'),
};

type LabPeriod = StudentToday['periods'][number];

// Where the student is in their lab day, from the clock time "HH:MM": in a period now, waiting for the
// next one, or done for today. Periods come in time order.
export function labNow(periods: LabPeriod[], clock: string): { now: LabPeriod | null; next: LabPeriod | null } {
  const now = periods.find((p) => p.start <= clock && clock < p.end) ?? null;
  const next = periods.find((p) => p.start > clock) ?? null;
  return { now, next };
}

export const clockOf = (date: Date) => `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
