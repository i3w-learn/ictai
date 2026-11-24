import { useEffect, useState } from 'react';
import { Megaphone, Pin } from 'lucide-react';
import type { Notice } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Card } from '../../ui/ui';
import { useLang } from '../../i18n/i18n';
import { whenShort, whoFor } from './notices';

const ASK_EVERY_MS = 60_000;

// PRD student app "Notices": what the school and the teacher want this student to know, pinned first,
// then newest. Read only. Nothing is shown when there are none, so the home screen stays calm.
export function StudentNotices() {
  const { call } = useApp();
  const { t, locale } = useLang();
  const [notices, setNotices] = useState<Notice[]>([]);
  useEffect(() => {
    let alive = true;
    // A missed ask is not worth a message: the next one comes in a minute.
    const ask = () => void call('GET /api/v1/notices/mine').then((n) => { if (alive) setNotices(n); }, () => undefined);
    ask();
    const timer = setInterval(ask, ASK_EVERY_MS);
    return () => { alive = false; clearInterval(timer); };
  }, [call]);

  if (notices.length === 0) return null;
  return (
    <ul className="grid gap-3" aria-label={t('Notices')}>
      {notices.map((n) => (
        <li key={n.id}>
          <Card className="ui-tone-butter flex items-start gap-4 px-6 py-4">
            <span className="mt-0.5 grid size-10 shrink-0 place-items-center rounded-full bg-primary/10 text-primary">
              {n.pinned ? <Pin className="size-5" aria-label={t('Pinned notice')} /> : <Megaphone className="size-5" aria-label={t('Notice')} />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-lg font-semibold">{n.title}</p>
              {n.body && <p className="whitespace-pre-wrap">{n.body}</p>}
              <p className="mt-0.5 text-sm text-muted-foreground">{[whoFor(n, t), n.byName, whenShort(n.createdAt, locale)].join(' · ')}</p>
            </div>
          </Card>
        </li>
      ))}
    </ul>
  );
}
