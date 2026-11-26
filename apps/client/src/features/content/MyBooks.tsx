import { useEffect, useState } from 'react';
import { FileText, Film, Gamepad2, Image, Link2, Music } from 'lucide-react';
import type { ContentItem, ContentKind } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { ErrorNote, PageTitle, useAction } from '../../ui/ui';
import { useT } from '../../i18n/i18n';
import { KIND_WORDS, shelve } from './files';
import { Viewer } from './Viewer';

export const KIND_ICON: Record<ContentKind, typeof FileText> = { pdf: FileText, image: Image, video: Film, audio: Music, link: Link2, activity: Gamepad2 };

// PRD student app "My books": everything the teachers have put in the library for this student's class,
// by subject and chapter. Tap one to open it. With `videos`, the same page holds the videos only.
export function MyBooks({ videos = false }: { videos?: boolean }) {
  const { call } = useApp();
  const t = useT();
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState<ContentItem | null>(null);
  const load = useAction(async () => { const all = await call('GET /api/v1/content/mine'); setItems(videos ? all.filter((i) => i.kind === 'video') : all); setLoaded(true); });
  const { run: loadNow } = load;
  useEffect(() => { void loadNow(); }, [loadNow]);

  if (open) return <Viewer item={open} onBack={() => setOpen(null)} />;
  return (
    <div className="mx-auto grid w-full max-w-4xl gap-5">
      <PageTitle sub={videos ? t('Videos for your class. Tap one to watch it.') : t('Books, pictures and videos your teachers have added for your class.')}>{videos ? t('Videos') : t('My books')}</PageTitle>
      {loaded && items.length === 0 && <p className="rounded-3xl border border-dashed border-border p-10 text-center text-muted-foreground">{videos ? t('No videos yet. When there is a video for your class, it shows here.') : t('Nothing here yet. When your teacher adds something for your class, it shows here.')}</p>}
      {shelve(items, t).map((shelf) => (
        <section key={shelf.subject} className="grid gap-3">
          <h2 className="font-display text-xl font-semibold">{shelf.subject}</h2>
          {shelf.chapters.map((ch) => (
            <div key={ch.chapter} className="grid gap-2">
              <h3 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">{ch.chapter}</h3>
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
                {ch.items.map((i) => {
                  const Icon = KIND_ICON[i.kind];
                  return (
                    <li key={i.id}>
                      <button type="button" onClick={() => setOpen(i)} className="flex h-full w-full cursor-pointer items-start gap-3 rounded-2xl border border-border bg-card px-4 py-4 text-left shadow-sm hover:border-accent/50">
                        <Icon className="mt-0.5 size-6 shrink-0 text-primary" strokeWidth={1.75} />
                        <span><span className="block text-lg font-semibold">{i.title}</span><span className="text-sm text-muted-foreground">{t(KIND_WORDS[i.kind])}{i.needsInternet ? ` · ${t('needs internet')}` : ''}</span></span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </section>
      ))}
      <ErrorNote message={load.error} />
    </div>
  );
}
