import { useEffect, useState } from 'react';
import { ArrowLeft, FileText, Film, Image, Link2, Music } from 'lucide-react';
import type { ContentItem, ContentKind } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, ErrorNote, PageTitle, useAction } from '../../ui/ui';
import { KIND_WORDS, shelve } from './files';
import { Viewer } from './Viewer';

const ICON: Record<ContentKind, typeof FileText> = { pdf: FileText, image: Image, video: Film, audio: Music, link: Link2 };

// PRD student app "My books": everything the teachers have put in the library for this student's class,
// by subject and chapter. Tap one to open it.
export function MyBooks({ onBack }: { onBack: () => void }) {
  const { call } = useApp();
  const [items, setItems] = useState<ContentItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [open, setOpen] = useState<ContentItem | null>(null);
  const load = useAction(async () => { setItems(await call('GET /api/v1/content/mine')); setLoaded(true); });
  useEffect(() => { void load.run(); }, []);

  if (open) return <Viewer item={open} onBack={() => setOpen(null)} />;
  return (
    <div className="mx-auto grid w-full max-w-4xl gap-5">
      <div><Button variant="quiet" onClick={onBack}><ArrowLeft className="size-4" /> Back</Button></div>
      <PageTitle sub="Books, pictures and videos your teachers have added for your class.">My books</PageTitle>
      {loaded && items.length === 0 && <p className="rounded-2xl border border-dashed border-border p-10 text-center text-muted-foreground">Nothing here yet. When your teacher adds something for your class, it shows here.</p>}
      {shelve(items).map((shelf) => (
        <section key={shelf.subject} className="grid gap-3">
          <h2 className="font-display text-xl font-semibold">{shelf.subject}</h2>
          {shelf.chapters.map((ch) => (
            <div key={ch.chapter} className="grid gap-2">
              <h3 className="text-sm font-semibold tracking-wide text-muted-foreground uppercase">{ch.chapter}</h3>
              <ul className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-3">
                {ch.items.map((i) => {
                  const Icon = ICON[i.kind];
                  return (
                    <li key={i.id}>
                      <button type="button" onClick={() => setOpen(i)} className="flex h-full w-full cursor-pointer items-start gap-3 rounded-2xl border border-border bg-card px-4 py-4 text-left shadow-sm hover:border-accent/50">
                        <Icon className="mt-0.5 size-6 shrink-0 text-primary" strokeWidth={1.75} />
                        <span><span className="block text-lg font-semibold">{i.title}</span><span className="text-sm text-muted-foreground">{KIND_WORDS[i.kind]}{i.needsInternet ? ' · needs internet' : ''}</span></span>
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
