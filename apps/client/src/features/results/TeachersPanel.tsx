import { useEffect, useState } from 'react';
import type { TeacherActivity } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, ErrorNote, Panel, useAction } from '../../ui/ui';
import { useLang, type T } from '../../i18n/i18n';

const when = (ms: number | null, t: T, locale: string | undefined) =>
  ms == null ? t('Never') : new Date(ms).toLocaleString(locale, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// Super Admin only: what each teacher has done.
export function TeachersPanel() {
  const { call } = useApp();
  const { t, locale } = useLang();
  const [rows, setRows] = useState<TeacherActivity[]>([]);
  const load = useAction(async () => setRows(await call('GET /api/v1/results/teachers')));
  const { run: loadNow } = load;
  useEffect(() => { void loadNow(); }, [loadNow]);

  return (
    <Panel title={t('What teachers have done')} actions={<Button variant="quiet" onClick={() => load.run()}>{t('Refresh')}</Button>}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr><th className="py-2 font-medium">{t('Name')}</th><th className="font-medium">{t('Quizzes made')}</th><th className="font-medium">{t('Quizzes run')}</th><th className="font-medium">{t('Students reached')}</th><th className="font-medium">{t('Last signed in')}</th></tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t border-border">
                <td className="py-2">{row.displayName}{row.role === 'super_admin' && <span className="text-muted-foreground"> ({t('Super Admin')})</span>}</td>
                <td className="tabular-nums">{row.quizzesMade}</td>
                <td className="tabular-nums">{row.runsHeld}</td>
                <td className="tabular-nums">{row.studentsReached}</td>
                <td className="text-muted-foreground">{when(row.lastSignInAt, t, locale)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ErrorNote message={load.error} />
    </Panel>
  );
}
