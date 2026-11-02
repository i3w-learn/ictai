import { useEffect, useState } from 'react';
import type { TeacherActivity } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, ErrorNote, Panel, useAction } from '../../ui/ui';

const when = (ms: number | null) =>
  ms == null ? 'Never' : new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// Super Admin only: what each teacher has done.
export function TeachersPanel() {
  const { call } = useApp();
  const [rows, setRows] = useState<TeacherActivity[]>([]);
  const load = useAction(async () => setRows(await call('GET /api/v1/results/teachers')));
  useEffect(() => { void load.run(); }, []);

  return (
    <Panel title="Teachers" actions={<Button variant="quiet" onClick={() => load.run()}>Refresh</Button>}>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="text-left text-muted-foreground">
            <tr><th className="py-2 font-medium">Name</th><th className="font-medium">Quizzes made</th><th className="font-medium">Quizzes run</th><th className="font-medium">Students reached</th><th className="font-medium">Last signed in</th></tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className="border-t border-border">
                <td className="py-2">{t.displayName}{t.role === 'super_admin' && <span className="text-muted-foreground"> (Super Admin)</span>}</td>
                <td className="tabular-nums">{t.quizzesMade}</td>
                <td className="tabular-nums">{t.runsHeld}</td>
                <td className="tabular-nums">{t.studentsReached}</td>
                <td className="text-muted-foreground">{when(t.lastSignInAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ErrorNote message={load.error} />
    </Panel>
  );
}
