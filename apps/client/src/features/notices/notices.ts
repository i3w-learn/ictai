import type { Notice } from '@ict/contracts';

// Who a notice is for, in words: "Whole school", "Class 7", "Class 7 A".
export const whoFor = (n: Pick<Notice, 'className' | 'sectionName'>) =>
  n.className === null ? 'Whole school' : `Class ${n.className}${n.sectionName ? ` ${n.sectionName}` : ''}`;

// "Show until 14 Nov" means all of that day: the notice goes at the last moment of the date picked.
// `day` is the date box's value, "2026-11-14", read in the PC's own time zone.
export function endOfDay(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y!, m! - 1, d!, 23, 59, 59, 999).getTime();
}

export const whenShort = (at: number) => new Date(at).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
