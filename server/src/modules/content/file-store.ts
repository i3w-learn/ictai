import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, closeSync, copyFileSync, createReadStream, existsSync, mkdirSync, openSync, readSync, readdirSync, renameSync, rmSync, statSync, statfsSync } from 'node:fs';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { CHUNK_BYTES } from '@ict/contracts';
import { LOCK_HEAD_BYTES, lockStart, unlockerAt } from './lock.js';

// Where uploaded files live on the server's disk. A file is kept under its own fingerprint (SHA-256),
// so the same file uploaded twice is stored once, and a name typed by a person never reaches the disk.
//
// A file may be locked (see lock.ts): our own videos and books arrive scrambled and stay scrambled
// on this disk. Everything below speaks of the real file: its real size, its real fingerprint, its
// real bytes. Only this class knows that the bytes on the disk are different.
export class FileStore {
  private readonly files: string;
  private readonly parts: string;

  // `key` opens locked files. Without it the store still keeps ordinary files as before.
  constructor(dataDir: string, private readonly key: Buffer | null = null) {
    this.files = join(dataDir, 'files');
    this.parts = join(dataDir, 'uploads');
    mkdirSync(this.files, { recursive: true });
    // Half-finished uploads do not survive a restart: the person simply uploads again.
    rmSync(this.parts, { recursive: true, force: true });
    mkdirSync(this.parts, { recursive: true });
  }

  newPart(): string {
    return randomUUID();
  }

  append(partId: string, bytes: Buffer) {
    appendFileSync(this.partPath(partId), bytes);
  }

  // Brings in a file that is already on this PC (a video that came with the app), as if it had been uploaded.
  copyIn(partId: string, from: string) {
    copyFileSync(from, this.partPath(partId));
  }

  // Where a half-finished upload sits on the disk, for a program that has to read it (LibreOffice).
  partFile(partId: string): string {
    return this.partPath(partId);
  }

  // Swaps a half-finished upload for another file on this disk (the PDF made from it).
  replacePart(partId: string, from: string) {
    renameSync(from, this.partPath(partId));
  }

  // A fresh empty folder for such a program to work in, and the way to throw it away.
  workDir(): { dir: string; remove: () => void } {
    const dir = join(this.parts, `work-${randomUUID()}`);
    mkdirSync(dir, { recursive: true });
    return { dir, remove: () => rmSync(dir, { recursive: true, force: true }) };
  }

  discard(partId: string) {
    rmSync(this.partPath(partId), { force: true });
  }

  get canUnlock(): boolean {
    return this.key !== null;
  }

  head(partId: string, n = 16): Buffer {
    return this.bytes(this.partPath(partId), 0, n);
  }

  // Fingerprints the finished upload and files it. Returns the fingerprint and whether it was already there.
  async keep(partId: string): Promise<{ hash: string; size: number; known: boolean }> {
    const path = this.partPath(partId);
    const hash = await new Promise<string>((resolve, reject) => {
      const h = createHash('sha256');
      this.read(path).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
    });
    const size = this.sizeOf(path);
    const dest = this.path(hash);
    const known = existsSync(dest);
    if (known) rmSync(path, { force: true });
    else {
      mkdirSync(join(this.files, hash.slice(0, 2)), { recursive: true });
      renameSync(path, dest);
    }
    return { hash, size, known };
  }

  has(hash: string): boolean {
    return existsSync(this.path(hash));
  }

  // One piece of a stored file. null when there is no such file or the piece is past its end.
  chunk(hash: string, index: number): { bytes: Buffer; last: boolean } | null {
    const path = this.path(hash);
    if (!existsSync(path)) return null;
    const size = this.sizeOf(path);
    const start = index * CHUNK_BYTES;
    if (start >= size && !(size === 0 && index === 0)) return null;
    const bytes = this.bytes(path, start, Math.min(CHUNK_BYTES, size - start));
    return { bytes, last: start + bytes.length >= size };
  }

  size(hash: string): number | null {
    const path = this.path(hash);
    return existsSync(path) ? this.sizeOf(path) : null;
  }

  // Bytes start..end (both counted in) of a stored file, read as they are sent, never all at once.
  stream(hash: string, start: number, end: number) {
    return this.read(this.path(hash), start, end);
  }

  remove(hash: string) {
    rmSync(this.path(hash), { force: true });
  }

  // Bytes still free on the disk the files live on.
  freeBytes(): number {
    const s = statfsSync(this.files);
    return s.bavail * s.bsize;
  }

  pendingParts(): number {
    return readdirSync(this.parts).length;
  }

  // The start number of a locked file, or null for an ordinary one.
  private lockOf(path: string): Buffer | null {
    const fd = openSync(path, 'r');
    try {
      const head = Buffer.alloc(LOCK_HEAD_BYTES);
      return lockStart(head.subarray(0, readSync(fd, head, 0, LOCK_HEAD_BYTES, 0)));
    } finally {
      closeSync(fd);
    }
  }

  private needKey(): Buffer {
    if (!this.key) throw new Error('This file is locked, and this server was built without the key that opens it.');
    return this.key;
  }

  private sizeOf(path: string): number {
    return statSync(path).size - (this.lockOf(path) ? LOCK_HEAD_BYTES : 0);
  }

  // Up to `n` real bytes of the file at `path`, from real byte `start`.
  private bytes(path: string, start: number, n: number): Buffer {
    const lock = this.lockOf(path);
    const fd = openSync(path, 'r');
    try {
      const buf = Buffer.alloc(n);
      const got = buf.subarray(0, readSync(fd, buf, 0, n, start + (lock ? LOCK_HEAD_BYTES : 0)));
      return lock ? unlockerAt(this.needKey(), lock, start).update(got) : got;
    } finally {
      closeSync(fd);
    }
  }

  // Real bytes start..end (both counted in; the whole file when left out), read as they are used.
  private read(path: string, start = 0, end?: number): Readable {
    const lock = this.lockOf(path);
    if (!lock) return createReadStream(path, { start, end });
    const unlock = unlockerAt(this.needKey(), lock, start);
    const raw = createReadStream(path, { start: start + LOCK_HEAD_BYTES, end: end === undefined ? undefined : end + LOCK_HEAD_BYTES });
    raw.on('error', (e) => unlock.destroy(e));
    unlock.on('close', () => raw.destroy());
    return raw.pipe(unlock);
  }

  private path(hash: string) {
    return join(this.files, hash.slice(0, 2), hash);
  }

  private partPath(partId: string) {
    return join(this.parts, `${partId}.part`);
  }
}
