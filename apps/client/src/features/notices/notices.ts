import type { Notice } from '@ict/contracts';
import type { T } from '../../i18n/i18n';

// Who a notice is for, in words: "Whole school", "Class 7", "Class 7 A".
export const whoFor = (n: Pick<Notice, 'className' | 'sectionName'>, t: T) =>
  n.className === null ? t('Whole school') : n.sectionName ? t('Class {name} {section}', { name: n.className, section: n.sectionName }) : t('Class {name}', { name: n.className });

// "Show until 14 Nov" means all of that day: the notice goes at the last moment of the date picked.
// `day` is the date box's value, "2026-11-14", read in the PC's own time zone.
export function endOfDay(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y!, m! - 1, d!, 23, 59, 59, 999).getTime();
}

export const whenShort = (at: number, locale: string | undefined) => new Date(at).toLocaleDateString(locale, { day: 'numeric', month: 'short' });
