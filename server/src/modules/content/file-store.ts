import { createHash, randomUUID } from 'node:crypto';
import { appendFileSync, closeSync, createReadStream, existsSync, mkdirSync, openSync, readSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CHUNK_BYTES } from '@ict/contracts';

// Where uploaded files live on the server's disk. A file is kept under its own fingerprint (SHA-256),
// so the same file uploaded twice is stored once, and a name typed by a person never reaches the disk.
export class FileStore {
  private readonly files: string;
  private readonly parts: string;

  constructor(dataDir: string) {
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

  discard(partId: string) {
    rmSync(this.partPath(partId), { force: true });
  }

  head(partId: string, n = 16): Buffer {
    const fd = openSync(this.partPath(partId), 'r');
    try {
      const buf = Buffer.alloc(n);
      return buf.subarray(0, readSync(fd, buf, 0, n, 0));
    } finally {
      closeSync(fd);
    }
  }

  // Fingerprints the finished upload and files it. Returns the fingerprint and whether it was already there.
  async keep(partId: string): Promise<{ hash: string; size: number; known: boolean }> {
    const path = this.partPath(partId);
    const hash = await new Promise<string>((resolve, reject) => {
      const h = createHash('sha256');
      createReadStream(path).on('data', (d) => h.update(d)).on('end', () => resolve(h.digest('hex'))).on('error', reject);
    });
    const size = statSync(path).size;
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
    const size = statSync(path).size;
    const start = index * CHUNK_BYTES;
    if (start >= size && !(size === 0 && index === 0)) return null;
    const fd = openSync(path, 'r');
    try {
      const buf = Buffer.alloc(Math.min(CHUNK_BYTES, size - start));
      readSync(fd, buf, 0, buf.length, start);
      return { bytes: buf, last: start + buf.length >= size };
    } finally {
      closeSync(fd);
    }
  }

  remove(hash: string) {
    rmSync(this.path(hash), { force: true });
  }

  pendingParts(): number {
    return readdirSync(this.parts).length;
  }

  private path(hash: string) {
    return join(this.files, hash.slice(0, 2), hash);
  }

  private partPath(partId: string) {
    return join(this.parts, `${partId}.part`);
  }
}
