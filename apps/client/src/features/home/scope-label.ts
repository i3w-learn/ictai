// The one-line summary of a teacher's classes and subjects in the Teachers list.
// Each half stands on its own: an empty half means "all", and must not hide the other half.
export function scopeLabel(s: { classIds: string[]; subjects: string[] }, className: (id: string) => string): string {
  if (!s.classIds.length && !s.subjects.length) return 'All classes and subjects';
  const classes = s.classIds.length
    ? `${s.classIds.length === 1 ? 'Class' : 'Classes'} ${s.classIds.map(className).join(', ')}`
    : 'All classes';
  const subjects = s.subjects.length ? s.subjects.join(', ') : 'All subjects';
  return `${classes} · ${subjects}`;
}
