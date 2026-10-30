import { useEffect, useState } from 'react';
import type { AuditEntry } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, ErrorNote, Panel, useAction } from '../../ui/ui';

// Plain words for each logged action. Unknown actions show their raw key.
const ACTION: Record<string, string> = {
  signin: 'signed in',
  'signin.failed': 'failed to sign in',
  'staff.add': 'added teacher',
  'staff.update': 'changed teacher',
  'staff.password': 'reset the password of',
  'staff.delete': 'deleted teacher',
  'student.delete': 'deleted student',
  'class.promote': 'moved all students out of class',
  'class.codes': 'made first sign-in codes for class',
  'class.cards': 'printed sign-in cards for class',
  'enrol_window.open': 'opened device joining',
  'device.enrol': 'joined the lab',
  'quiz.open': 'opened Lab Mode for',
  'quiz.start': 'started the quiz',
  'quiz.end': 'ended the quiz',
};

const when = (ms: number) => new Date(ms).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

// Spec 4.1: who did what and when. Super Admin only.
export function AuditPanel() {
  const { call } = useApp();
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [more, setMore] = useState(true);

  const load = useAction(async (before?: number) => {
    const page = await call('GET /api/v1/audit', { query: before ? { before } : {} });
    setEntries((prev) => (before ? [...prev, ...page] : page));
    setMore(page.length === 100);
  });
  useEffect(() => { void load.run(); }, []);

  return (
    <Panel title="Activity log" actions={<Button variant="quiet" onClick={() => load.run()}>Refresh</Button>}>
      <ul className="grid gap-1 text-sm">
        {entries.map((e) => (
          <li key={e.id} className="flex flex-wrap gap-x-3 border-b border-border py-2 last:border-0">
            <span className="w-32 shrink-0 tabular-nums text-muted-foreground">{when(e.at)}</span>
            <span className="min-w-0 flex-1">
              <b className="font-semibold">{e.actorName ?? (e.action === 'signin.failed' ? 'Someone' : e.actorKind)}</b>{' '}
              {ACTION[e.action] ?? e.action}
              {e.targetName && e.actorName !== e.targetName && <>{e.action === 'signin' ? ' on' : ''} <b className="font-semibold">{e.targetName}</b></>}
              {e.action === 'signin.failed' && e.target && <span className="text-muted-foreground"> as “{e.target}”</span>}
            </span>
          </li>
        ))}
      </ul>
      {more && entries.length > 0 && (
        <Button variant="quiet" disabled={load.busy} onClick={() => load.run(entries[entries.length - 1]!.id)}>Show older</Button>
      )}
      <ErrorNote message={load.error} />
    </Panel>
  );
}
