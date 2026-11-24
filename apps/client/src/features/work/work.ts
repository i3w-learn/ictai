import type { MyWork } from '@ict/contracts';
import { tk } from '../../i18n/i18n';

// "Due 14 Nov" means the end of that day.
export function endOfDay(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y!, m! - 1, d!, 23, 59, 59, 999).getTime();
}

export const dayShort = (at: number, locale?: string) => new Date(at).toLocaleDateString(locale, { day: 'numeric', month: 'short' });

// The student's list in the order they should look at it: still to do (overdue first, then soonest due),
// then handed in, then marked.
export function sortWork(list: MyWork[]): MyWork[] {
  const rank = { todo: 0, submitted: 1, marked: 2 } as const;
  const due = (w: MyWork) => w.dueAt ?? Number.MAX_SAFE_INTEGER;
  return [...list].sort((a, b) => rank[a.status] - rank[b.status] || Number(b.overdue) - Number(a.overdue) || due(a) - due(b));
}

export const STATUS_WORDS = { todo: tk('To do'), submitted: tk('Handed in'), marked: tk('Marked') } as const;
