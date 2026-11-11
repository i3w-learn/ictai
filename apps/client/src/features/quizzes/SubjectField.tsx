import { useApp } from '../../app/app-context';
import { Field, Select } from '../../ui/ui';
import { matchSubject } from './subject';

// The subjects the Super Admin gave this teacher, or null when they may use any subject.
export function useMySubjects(): string[] | null {
  const p = useApp().state.session?.principal;
  return p?.kind === 'staff' ? p.subjects : null;
}

// A teacher with set subjects picks one of them; everyone else types any subject.
export function SubjectField({ id, value, onChange, placeholder }: { id: string; value: string; onChange: (v: string) => void; placeholder?: string }) {
  const subjects = useMySubjects();
  if (!subjects) return <Field id={id} className="w-44" label="Subject" placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />;
  const shown = matchSubject(subjects, value);
  // An older quiz may carry a subject that isn't in the list any more; show it rather than a blank.
  const options = shown && !subjects.includes(shown) ? [...subjects, shown] : subjects;
  return (
    <label className="grid gap-1.5">
      <span className="text-[13px] font-medium text-muted-foreground">Subject</span>
      <Select id={id} aria-label="Subject" value={shown} onChange={(e) => onChange(e.target.value)}>
        <option value="">Choose a subject</option>
        {options.map((s) => <option key={s} value={s}>{s}</option>)}
      </Select>
    </label>
  );
}
