import { useEffect, useState } from 'react';
import { Film } from 'lucide-react';
import type { ContentItem } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { ErrorNote, Panel, useAction } from '../../ui/ui';
import { sizeWords } from './files';
import { useT } from '../../i18n/i18n';

// Every video in the library, class by class: the ones that came with the app and the ones teachers
// added. Tap one to play it, and from there show it to the class.
export function VideosPanel({ onOpen, refresh }: { onOpen: (item: ContentItem) => void; refresh: number }) {
  const { call } = useApp();
  const t = useT();
  const [videos, setVideos] = useState<ContentItem[] | null>(null);
  const load = useAction(async () => setVideos((await call('GET /api/v1/content', { query: {} })).filter((i) => i.kind === 'video')));
  const { run: loadNow } = load;
  useEffect(() => { void loadNow(); }, [loadNow, refresh]);

  const classes = [...new Set((videos ?? []).map((v) => v.className))].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return (
    <Panel title={t('Videos in the library')}>
      {videos?.length === 0 && <p className="rounded-3xl border border-dashed border-border p-8 text-center text-muted-foreground">{t('No videos yet. Add one under Teach → Library.')}</p>}
      {classes.map((name) => (
        <section key={name} className="grid gap-2">
          <h3 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">{t('Class {name}', { name })}</h3>
          <ul className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
            {videos!.filter((v) => v.className === name).map((v) => (
              <li key={v.id}>
                <button type="button" onClick={() => onOpen(v)} className="flex h-full w-full cursor-pointer items-start gap-3 rounded-2xl border border-border bg-card px-4 py-4 text-left shadow-sm hover:border-accent/50">
                  <Film className="mt-0.5 size-6 shrink-0 text-primary" strokeWidth={1.75} />
                  <span>
                    <span className="block text-lg font-semibold">{v.title}</span>
                    <span className="text-sm text-muted-foreground">{[v.subject, v.chapter, v.size ? sizeWords(v.size) : null].filter(Boolean).join(' · ')}</span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <ErrorNote message={load.error} />
    </Panel>
  );
}
