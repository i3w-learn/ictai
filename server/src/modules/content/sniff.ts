import type { ContentKind } from '@ict/contracts';

// What a file really is, read from its first bytes rather than trusted from its name.
// Only the kinds the library can show are let in; anything else (a program, a zip, a document
// format the app cannot open) is refused.
export function sniff(head: Buffer): { kind: Exclude<ContentKind, 'link'>; mime: string } | null {
  const at = (offset: number, text: string) => head.subarray(offset, offset + text.length).toString('latin1') === text;
  const bytes = (...b: number[]) => b.every((v, i) => head[i] === v);

  if (at(0, '%PDF-')) return { kind: 'pdf', mime: 'application/pdf' };
  if (bytes(0x89, 0x50, 0x4e, 0x47)) return { kind: 'image', mime: 'image/png' };
  if (bytes(0xff, 0xd8, 0xff)) return { kind: 'image', mime: 'image/jpeg' };
  if (at(0, 'GIF87a') || at(0, 'GIF89a')) return { kind: 'image', mime: 'image/gif' };
  if (at(0, 'RIFF') && at(8, 'WEBP')) return { kind: 'image', mime: 'image/webp' };
  if (at(0, 'RIFF') && at(8, 'WAVE')) return { kind: 'audio', mime: 'audio/wav' };
  if (at(4, 'ftyp')) return at(8, 'M4A') ? { kind: 'audio', mime: 'audio/mp4' } : { kind: 'video', mime: 'video/mp4' };
  if (bytes(0x1a, 0x45, 0xdf, 0xa3)) return { kind: 'video', mime: 'video/webm' };
  if (at(0, 'OggS')) return { kind: 'audio', mime: 'audio/ogg' };
  if (at(0, 'ID3') || (head[0] === 0xff && (head[1]! & 0xe0) === 0xe0)) return { kind: 'audio', mime: 'audio/mpeg' };
  return null;
}
