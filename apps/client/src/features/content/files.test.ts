import { describe, expect, it } from 'vitest';
import { CHUNK_BYTES, MAX_FILE_BYTES, type ContentItem } from '@ict/contracts';
import { fetchFile, fileProblem, fromBase64, sendFile, shelve, sizeWords, toBase64 } from './files';

const bytesOf = (n: number) => Uint8Array.from({ length: n }, (_, i) => (i * 31 + 7) % 256);

describe('library files', () => {
  it('turns bytes into text and back without losing any', () => {
    const bytes = bytesOf(70_000);
    expect(fromBase64(toBase64(bytes))).toEqual(bytes);
    expect(toBase64(new Uint8Array([104, 105]))).toBe('aGk=');
  });

  it('sends a file in order, one piece at a time, and reports progress', async () => {
    const data = bytesOf(CHUNK_BYTES * 2 + 100);
    const got: Uint8Array[] = [];
    const progress: string[] = [];
    const api = {
      start: async (name: string, size: number) => { expect([name, size]).toEqual(['book.pdf', data.length]); return { uploadId: 'u1', chunks: 3 }; },
      piece: async (_id: string, index: number, b64: string) => { expect(index).toBe(got.length); got.push(fromBase64(b64)); },
    };
    const file = Object.assign(new Blob([data as BlobPart]), { name: 'book.pdf' });
    expect(await sendFile(api, file, (d, t) => progress.push(`${d}/${t}`))).toBe('u1');
    expect(got.map((g) => g.length)).toEqual([CHUNK_BYTES, CHUNK_BYTES, 100]);
    expect(progress).toEqual(['1/3', '2/3', '3/3']);
  });

  it('fetches a file piece by piece and puts it back together', async () => {
    const data = bytesOf(CHUNK_BYTES + 50);
    const api = { chunk: async (_h: string, i: number) => ({ data: toBase64(data.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES)), last: i === 1 }) };
    const blob = await fetchFile(api, { fileHash: 'h', mime: 'application/pdf', size: data.length }, () => undefined, () => false);
    expect(blob!.type).toBe('application/pdf');
    expect(new Uint8Array(await blob!.arrayBuffer())).toEqual(data);
  });

  it('gives up quietly when the screen was closed', async () => {
    const api = { chunk: async () => ({ data: 'aGk=', last: false }) };
    expect(await fetchFile(api, { fileHash: 'h', mime: null, size: 10 }, () => undefined, () => true)).toBeNull();
  });

  it('says why a file cannot be sent', () => {
    expect(fileProblem({ size: 0 })).toBe('This file is empty.');
    expect(fileProblem({ size: MAX_FILE_BYTES + 1 })).toMatch(/limit is 100 MB/);
    expect(fileProblem({ size: 5000 })).toBeNull();
  });

  it('writes sizes in words', () => {
    expect(sizeWords(300)).toBe('1 KB');
    expect(sizeWords(2_500_000)).toBe('2.4 MB');
    expect(sizeWords(50 * 1024 * 1024)).toBe('50 MB');
  });

  it('shelves the library by subject, then chapter', () => {
    const item = (title: string, subject: string | null, chapter: string | null) => ({ title, subject, chapter }) as ContentItem;
    const shelves = shelve([item('Decimals', 'Maths', 'Numbers'), item('Fractions', 'Maths', 'Numbers'), item('Shapes', 'Maths', null), item('Poster', null, null)]);
    expect(shelves.map((s) => [s.subject, s.chapters.map((c) => `${c.chapter}:${c.items.length}`)])).toEqual([['Maths', ['Numbers:2', 'General:1']], ['Other', ['General:1']]]);
  });
});
