import { CHUNK_BYTES, MAX_FILE_BYTES, chunksOf, type ContentItem, type ContentKind } from '@ict/contracts';

// Bytes <-> base64 for the pieces a file travels in. Done in small steps so a 512 KB piece never
// builds one enormous argument list.
export function toBase64(bytes: Uint8Array): string {
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

export function fromBase64(data: string): Uint8Array {
  const text = atob(data);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes;
}

export const sizeWords = (bytes: number) =>
  bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

// Why a picked file cannot be sent, in words for the teacher; null when it can.
export function fileProblem(file: { size: number }): string | null {
  if (file.size === 0) return 'This file is empty.';
  if (file.size > MAX_FILE_BYTES) return `This file is ${sizeWords(file.size)}. The limit is ${sizeWords(MAX_FILE_BYTES)}.`;
  return null;
}

export const KIND_WORDS: Record<ContentKind, string> = { pdf: 'PDF', image: 'Picture', video: 'Video', audio: 'Sound', link: 'Web link' };

type Call = (key: never, input?: never) => Promise<never>;
interface Api {
  start(fileName: string, size: number): Promise<{ uploadId: string; chunks: number }>;
  piece(uploadId: string, index: number, data: string): Promise<void>;
  chunk(hash: string, index: number): Promise<{ data: string; last: boolean }>;
}

// Sends a file to the server piece by piece. Returns the upload's id, ready to be filed.
export async function sendFile(api: Pick<Api, 'start' | 'piece'>, file: Blob & { name: string }, onProgress: (done: number, total: number) => void): Promise<string> {
  const { uploadId, chunks } = await api.start(file.name, file.size);
  for (let i = 0; i < chunks; i++) {
    const bytes = new Uint8Array(await file.slice(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES).arrayBuffer());
    await api.piece(uploadId, i, toBase64(bytes));
    onProgress(i + 1, chunks);
  }
  return uploadId;
}

// Fetches a whole file from the server and hands it to the page as something it can show.
// `stopped` lets a screen that was closed give up between pieces.
export async function fetchFile(api: Pick<Api, 'chunk'>, item: Pick<ContentItem, 'fileHash' | 'mime' | 'size'>, onProgress: (done: number, total: number) => void, stopped: () => boolean): Promise<Blob | null> {
  const total = chunksOf(item.size ?? 0);
  const parts: Uint8Array[] = [];
  for (let i = 0; ; i++) {
    if (stopped()) return null;
    const piece = await api.chunk(item.fileHash!, i);
    parts.push(fromBase64(piece.data));
    onProgress(i + 1, total);
    if (piece.last) break;
  }
  return new Blob(parts as BlobPart[], { type: item.mime ?? 'application/octet-stream' });
}

export type { Call };

// The library as a student reads it: subjects, each with its chapters, each with its items.
export function shelve(items: ContentItem[]): { subject: string; chapters: { chapter: string; items: ContentItem[] }[] }[] {
  const subjects = new Map<string, Map<string, ContentItem[]>>();
  for (const item of items) {
    const chapters = subjects.get(item.subject ?? 'Other') ?? new Map<string, ContentItem[]>();
    chapters.set(item.chapter ?? 'General', [...(chapters.get(item.chapter ?? 'General') ?? []), item]);
    subjects.set(item.subject ?? 'Other', chapters);
  }
  return [...subjects].map(([subject, chapters]) => ({ subject, chapters: [...chapters].map(([chapter, list]) => ({ chapter, items: list })) }));
}
