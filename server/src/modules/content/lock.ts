import { createDecipheriv, type Decipheriv } from 'node:crypto';

// A locked file is one of our videos or books scrambled with the app's secret key, so that the file
// on a pen drive, in the installer folder or on the server's disk plays in no other program.
// It is made by installer/lock-videos.mjs, which must agree with this file on the layout:
//   8 bytes   the word "ICTLOCK1"
//   16 bytes  a random start number, different for every file
//   the rest  the file itself, scrambled with AES-256 in counter mode
// Counter mode scrambles each 16 bytes on their own, so any part of a video can be opened without
// reading what comes before it. That is what lets a player skip ahead.
export const LOCK_EXT = '.ictlock';
const MAGIC = Buffer.from('ICTLOCK1', 'latin1');
export const LOCK_HEAD_BYTES = MAGIC.length + 16;
const BLOCK = 16;

// The key is written as 64 letters and digits (hex). Anything else is no key.
export function parseKey(hex: string | undefined | null): Buffer | null {
  return hex && /^[0-9a-f]{64}$/i.test(hex) ? Buffer.from(hex, 'hex') : null;
}

// The start number of a locked file, read from its first bytes. null when the file is not locked.
export function lockStart(head: Buffer): Buffer | null {
  if (head.length < LOCK_HEAD_BYTES || !head.subarray(0, MAGIC.length).equals(MAGIC)) return null;
  return head.subarray(MAGIC.length, LOCK_HEAD_BYTES);
}

// Something that unscrambles a locked file from byte `offset` of the real file onwards.
export function unlockerAt(key: Buffer, start: Buffer, offset: number): Decipheriv {
  const counter = (BigInt(`0x${start.toString('hex')}`) + BigInt(Math.floor(offset / BLOCK))) & ((1n << 128n) - 1n);
  const d = createDecipheriv('aes-256-ctr', key, Buffer.from(counter.toString(16).padStart(32, '0'), 'hex'));
  // The offset may fall inside a 16-byte block: the first part of that block is passed over.
  d.update(Buffer.alloc(offset % BLOCK));
  return d;
}
