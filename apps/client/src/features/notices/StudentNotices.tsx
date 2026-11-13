import { useEffect, useState } from 'react';
import { Pin } from 'lucide-react';
import type { Notice } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Panel } from '../../ui/ui';
import { whenShort, whoFor } from './notices';

const ASK_EVERY_MS = 60_000;

// PRD student app "Notices": what the school and the teacher want this student to know, pinned first,
// then newest. Read only. Nothing is shown when there are none, so the home screen stays calm.
export function StudentNotices() {
  const { call } = useApp();
  const [notices, setNotices] = useState<Notice[]>([]);
  useEffect(() => {
    let alive = true;
    // A missed ask is not worth a message: the next one comes in a minute.
    const ask = () => void call('GET /api/v1/notices/mine').then((n) => { if (alive) setNotices(n); }, () => undefined);
    ask();
    const t = setInterval(ask, ASK_EVERY_MS);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (notices.length === 0) return null;
  return (
    <Panel title="Notices">
      <ul className="grid gap-3">
        {notices.map((n) => (
          <li key={n.id} className="rounded-xl border border-border px-4 py-3">
            <p className="flex flex-wrap items-center gap-2 text-lg font-semibold">
              {n.pinned && <Pin className="size-4 text-primary" aria-label="Pinned" />}
              {n.title}
            </p>
            {n.body && <p className="mt-1 whitespace-pre-wrap">{n.body}</p>}
            <p className="mt-1 text-sm text-muted-foreground">{[whoFor(n), n.byName, whenShort(n.createdAt)].join(' · ')}</p>
          </li>
        ))}
      </ul>
    </Panel>
  );
}
