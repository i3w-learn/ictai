import type { T } from '../../i18n/i18n';

// The one-line summary of a teacher's classes and subjects in the Teachers list.
// Each half stands on its own: an empty half means "all", and must not hide the other half.
export function scopeLabel(s: { classIds: string[]; subjects: string[] }, className: (id: string) => string, t: T): string {
  if (!s.classIds.length && !s.subjects.length) return t('All classes and subjects');
  const names = s.classIds.map(className).join(', ');
  const classes = s.classIds.length === 0 ? t('All classes') : s.classIds.length === 1 ? t('Class {name}', { name: names }) : t('Classes {names}', { names });
  const subjects = s.subjects.length ? s.subjects.join(', ') : t('All subjects');
  return `${classes} · ${subjects}`;
}
