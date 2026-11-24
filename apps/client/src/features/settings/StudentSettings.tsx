import type { StudentPrefs, TextSize } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, Card, ErrorNote, PageTitle, cn } from '../../ui/ui';
import { tk, useT } from '../../i18n/i18n';

const SIZES: { value: TextSize; label: string; sample: string }[] = [
  { value: 'normal', label: tk('Normal'), sample: 'text-base' },
  { value: 'large', label: tk('Large'), sample: 'text-xl' },
  { value: 'xlarge', label: tk('Very large'), sample: 'text-2xl' },
];

// PRD student app "Settings": text size, high contrast, an easy-to-read font, and sign out.
// Each choice is saved the moment it is made and follows the student to any lab PC.
// (The app's language is not one of them: it is a choice of the PC, made with the switch in the top bar.)
export function StudentSettings({ prefs, onChange, error }: { prefs: StudentPrefs; onChange: (p: StudentPrefs) => void; error: string | null }) {
  const { signOut } = useApp();
  const t = useT();
  return (
    <div className="mx-auto grid w-full max-w-2xl gap-6">
      <PageTitle sub={t('Your choices are saved for you. They will be here on any lab PC you sign in to.')}>{t('Settings')}</PageTitle>

      <Card className="grid gap-3 p-5">
        <h2 className="text-lg font-semibold">{t('Text size')}</h2>
        <div className="grid gap-2 sm:grid-cols-3" role="radiogroup" aria-label={t('Text size')}>
          {SIZES.map((s) => (
            <button
              key={s.value} type="button" role="radio" aria-checked={prefs.textSize === s.value}
              className={cn('cursor-pointer rounded-xl border-2 px-3 py-4 text-center font-semibold', prefs.textSize === s.value ? 'border-primary bg-primary/10 text-primary' : 'border-border bg-card')}
              onClick={() => onChange({ ...prefs, textSize: s.value })}
            >
              <span className={cn('block', s.sample)}>Aa</span>
              <span className="text-sm">{t(s.label)}</span>
            </button>
          ))}
        </div>
      </Card>

      <Card className="grid gap-4 p-5">
        <Switch id="pref-contrast" label={t('Stronger colours')} hint={t('Darker text and lines, easier to see.')} checked={prefs.highContrast} onChange={(v) => onChange({ ...prefs, highContrast: v })} />
        <Switch id="pref-font" label={t('Easy-to-read letters')} hint={t('Rounder letters with more space between them.')} checked={prefs.easyFont} onChange={(v) => onChange({ ...prefs, easyFont: v })} />
      </Card>

      <ErrorNote message={error} />
      <div><Button variant="quiet" onClick={() => signOut()}>{t('Sign out')}</Button></div>
    </div>
  );
}

function Switch({ id, label, hint, checked, onChange }: { id: string; label: string; hint: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3">
      <input id={id} type="checkbox" className="mt-1 size-5 accent-[var(--primary)]" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span><span className="block text-lg font-semibold">{label}</span><span className="text-muted-foreground">{hint}</span></span>
    </label>
  );
}
