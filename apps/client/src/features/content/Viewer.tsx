import { useEffect, useState } from 'react';
import { ArrowLeft } from 'lucide-react';
import type { ContentItem } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { Button, Card, ErrorNote, Note } from '../../ui/ui';
import { fetchFile, KIND_WORDS, sizeWords } from './files';

// Opens one library item: a picture as a picture, a PDF in the built-in reader, video and sound with
// their own players.
// A picture, video or sound is streamed: the player asks the server for the part it needs, so a big
// video starts at once and is never held whole in this PC's memory. If streaming does not work on this
// PC (or there is no native side, as in tests), the file is fetched in pieces and shown from memory,
// which is also how a PDF is always opened.
export function Viewer({ item, onBack }: { item: ContentItem; onBack: () => void }) {
  const { call, platform } = useApp();
  const [streamFailed, setStreamFailed] = useState(false);
  const stream = item.fileHash && streams(item.kind) && !streamFailed ? (platform.fileUrl?.(item.fileHash) ?? null) : null;
  const [fetched, setFetched] = useState<string | null>(null);
  const [progress, setProgress] = useState<[number, number]>([0, 1]);
  const [error, setError] = useState<string | null>(null);
  const url = stream ?? fetched;
  const setUrl = setFetched;
  const onError = stream ? () => setStreamFailed(true) : undefined;

  useEffect(() => {
    if (!item.fileHash || stream) return;
    let stopped = false;
    let made: string | null = null;
    const api = { chunk: (hash: string, index: number) => call('GET /api/v1/files/:hash/chunks/:index', { params: { hash, index } }) };
    fetchFile(api, item, (d, t) => { if (!stopped) setProgress([d, t]); }, () => stopped).then(
      (blob) => { if (blob && !stopped) { made = URL.createObjectURL(blob); setUrl(made); } },
      (e) => { if (!stopped) setError(e instanceof Error ? e.message : 'Could not open this file.'); },
    );
    // Leaving the screen stops the fetch and frees the memory the file took.
    return () => { stopped = true; if (made) URL.revokeObjectURL(made); };
  }, [item.id, stream]);

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
          {item.kind === 'image' && <img src={url} alt={item.title} onError={onError} className="mx-auto max-h-[75vh] max-w-full rounded-xl border border-border bg-card" />}
          {item.kind === 'pdf' && <iframe src={url} title={item.title} className="h-[78vh] w-full rounded-xl border border-border bg-card" />}
          {item.kind === 'video' && <video src={url} controls onError={onError} className="mx-auto max-h-[75vh] w-full rounded-xl bg-black" />}
          {item.kind === 'audio' && <Card className="p-8"><audio src={url} controls onError={onError} className="w-full" /></Card>}
        </>
      )}
    </div>
  );
}

// The kinds whose players can ask for a file part by part and say when that fails.
const streams = (kind: ContentItem['kind']) => kind === 'image' || kind === 'video' || kind === 'audio';
