import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { ContentItem } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, Card, ErrorNote, Note } from '../../ui/ui';
import { fetchFile, KIND_WORDS, sizeWords } from './files';

// Opens one library item. A file is fetched from the server in pieces, then shown in the page:
// a picture as a picture, a PDF in the built-in reader, video and sound with their own players.
export function Viewer({ item, onBack }: { item: ContentItem; onBack: () => void }) {
  const { call } = useApp();
  const [url, setUrl] = useState<string | null>(null);
  const [progress, setProgress] = useState<[number, number]>([0, 1]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!item.fileHash) return;
    let stopped = false;
    let made: string | null = null;
    const api = { chunk: (hash: string, index: number) => call('GET /api/v1/files/:hash/chunks/:index', { params: { hash, index } }) };
    fetchFile(api, item, (d, t) => { if (!stopped) setProgress([d, t]); }, () => stopped).then(
      (blob) => { if (blob && !stopped) { made = URL.createObjectURL(blob); setUrl(made); } },
      (e) => { if (!stopped) setError(e instanceof Error ? e.message : 'Could not open this file.'); },
    );
    // Leaving the screen stops the fetch and frees the memory the file took.
    return () => { stopped = true; if (made) URL.revokeObjectURL(made); };
  }, [item.id]);

  const percent = Math.round((progress[0] / progress[1]) * 100);
  return (
    <div className="mx-auto grid w-full max-w-5xl gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="quiet" onClick={onBack}><ArrowLeft className="size-4" /> Back</Button>
        <h1 className="min-w-48 flex-1 font-display text-2xl font-semibold">{item.title}</h1>
        <span className="text-sm text-muted-foreground">{[KIND_WORDS[item.kind], item.subject, item.chapter, item.size ? sizeWords(item.size) : null].filter(Boolean).join(' · ')}</span>
      </div>
      <ErrorNote message={error} />

      {item.kind === 'link' ? (
        <Card className="grid gap-3 p-6">
          <Note>This is a web page. It opens only when the lab has internet.</Note>
          <p className="text-lg break-all select-all">{item.url}</p>
        </Card>
      ) : !url && !error ? (
        <Card className="grid gap-3 p-8 text-center">
          <p className="text-muted-foreground">Opening… {percent}%</p>
          <div className="mx-auto h-2 w-64 overflow-hidden rounded-full bg-secondary" role="progressbar" aria-valuenow={percent} aria-valuemin={0} aria-valuemax={100} aria-label="Opening the file">
            <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
          </div>
        </Card>
      ) : url && (
        <>
          {item.kind === 'image' && <img src={url} alt={item.title} className="mx-auto max-h-[75vh] max-w-full rounded-xl border border-border bg-card" />}
          {item.kind === 'pdf' && <iframe src={url} title={item.title} className="h-[78vh] w-full rounded-xl border border-border bg-card" />}
          {item.kind === 'video' && <video src={url} controls className="mx-auto max-h-[75vh] w-full rounded-xl bg-black" />}
          {item.kind === 'audio' && <Card className="p-8"><audio src={url} controls className="w-full" /></Card>}
        </>
      )}
    </div>
  );
}
