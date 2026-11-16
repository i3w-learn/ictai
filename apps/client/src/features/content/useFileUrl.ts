import { useEffect, useState } from 'react';
import type { ContentItem } from '@ict/contracts';
import { useApp } from '../../app/app-context';
import { useLatest } from '../../ui/ui';
import { fetchFile } from './files';

// The kinds whose players can ask for a file part by part and say when that fails.
const streams = (kind: ContentItem['kind']) => kind === 'image' || kind === 'video' || kind === 'audio';

// An address a picture, PDF, video or sound player can be pointed at for one library file.
// A picture, video or sound is streamed: the player asks the server for the part it needs, so a big
// video starts at once and is never held whole in this PC's memory. If streaming does not work on this
// PC (or there is no native side, as in tests), the file is fetched in pieces and shown from memory,
// which is also how a PDF is always opened. `onError` is what a player calls when the stream fails;
// it is undefined once there is nothing else left to try.
export function useFileUrl(item: Pick<ContentItem, 'id' | 'kind' | 'fileHash' | 'mime' | 'size'>) {
  const { call, platform } = useApp();
  const [streamFailed, setStreamFailed] = useState(false);
  const stream = item.fileHash && streams(item.kind) && !streamFailed ? (platform.fileUrl?.(item.fileHash) ?? null) : null;
  const [fetched, setFetched] = useState<string | null>(null);
  const [progress, setProgress] = useState<[number, number]>([0, 1]);
  const [error, setError] = useState<string | null>(null);

  // The file is fetched afresh only for a different file, not each time the same one is handed in again.
  const itemNow = useLatest(item);
  const { id, fileHash } = item;
  useEffect(() => {
    if (!fileHash || stream) return;
    let stopped = false;
    let made: string | null = null;
    const api = { chunk: (hash: string, index: number) => call('GET /api/v1/files/:hash/chunks/:index', { params: { hash, index } }) };
    fetchFile(api, itemNow.current, (d, t) => { if (!stopped) setProgress([d, t]); }, () => stopped).then(
      (blob) => { if (blob && !stopped) { made = URL.createObjectURL(blob); setFetched(made); } },
      (e) => { if (!stopped) setError(e instanceof Error ? e.message : 'Could not open this file.'); },
    );
    // Leaving the screen stops the fetch and frees the memory the file took.
    return () => { stopped = true; if (made) URL.revokeObjectURL(made); };
  }, [call, itemNow, id, fileHash, stream]);

  return { url: stream ?? fetched, percent: Math.round((progress[0] / progress[1]) * 100), error, onError: stream ? () => setStreamFailed(true) : undefined };
}
