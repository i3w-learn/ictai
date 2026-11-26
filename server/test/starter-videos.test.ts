import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createContainer } from '../src/container.js';
import { openDb } from '../src/infra/db/index.js';
import { filingFromName } from '../src/modules/content/starter-videos.js';

const mp4 = (fill: number) => Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom'), Buffer.alloc(2000, fill)]);
const INTEGERS = 'G6-Mar-Mat-06Int11-Addition of Integers -Part 1-DMV-ILL.mp4';

// A server whose installer left `files` in the starter videos folder.
async function server(files: Record<string, Buffer>, contentKey: Buffer | null = null) {
  const dataDir = mkdtempSync(join(tmpdir(), 'ict-starter-'));
  const starterDir = join(dataDir, 'starter-videos');
  mkdirSync(starterDir);
  for (const [name, bytes] of Object.entries(files)) writeFileSync(join(starterDir, name), bytes);
  const diary: string[] = [];
  const c = createContainer({ db: openDb(':memory:'), now: () => 1_800_000_000_000, version: 'test', dataDir, starterDir, contentKey, log: (event, d) => diary.push(`${event} ${JSON.stringify(d)}`) });
  c.identity.setCertFingerprint('AA:BB');
  const app = buildApp(c);
  await app.ready();
  const admin = async () => {
    await c.staffAuth.upsertAccount({ username: 'admin', password: 'admin-pass', role: 'super_admin' });
    const token = (await app.inject({ method: 'POST', url: '/api/v1/auth/staff', payload: { username: 'admin', password: 'admin-pass' } })).json().token;
    return { authorization: `Bearer ${token}` };
  };
  const library = async (headers: object) => (await app.inject({ method: 'GET', url: '/api/v1/content', headers: headers as Record<string, string> })).json();
  return { c, app, admin, library, diary, starterDir, dataDir };
}

describe('videos that come with the app', () => {
  it('reads the class, subject and title from the file name', () => {
    expect(filingFromName(INTEGERS)).toEqual({ className: '6', subject: 'Maths', title: 'Addition of Integers - Part 1' });
    expect(filingFromName('G10-Eng-Sci-Light.mp4')).toEqual({ className: '10', subject: 'Science', title: 'Light' });
    expect(filingFromName('g07-Water cycle.webm')).toEqual({ className: '7', subject: null, title: 'Water cycle' });
    // "Mar" is the language (Marathi), not the subject; "Che" is.
    expect(filingFromName('G9-Mar-Che-03AAA14-Atomic Size-DMV-ILL.mp4')).toEqual({ className: '9', subject: 'Chemistry', title: 'Atomic Size' });
    expect(filingFromName('G10-Mar-Che-04CC01-Introduction to Carbon Compounds-DMV-ILL.mp4')).toEqual({ className: '10', subject: 'Chemistry', title: 'Introduction to Carbon Compounds' });
    expect(filingFromName('holiday.mp4')).toBeNull();
  });

  it('waits for the school to make its Super Admin, then puts them in the library under their class', async () => {
    const { c, admin, library, app } = await server({ [INTEGERS]: mp4(1), 'G6-Mar-Mat-06Int12-Addition of Integers -Part 2-DMV-ILL.mp4': mp4(2) });
    expect(await c.starter!.sync()).toBe(false); // nobody to own them yet
    const headers = await admin();
    expect(await library(headers)).toEqual([]);
    expect(await c.starter!.sync()).toBe(true);

    const items = await library(headers);
    expect(items.map((i: { title: string }) => i.title).sort()).toEqual(['Addition of Integers - Part 1', 'Addition of Integers - Part 2']);
    expect(items[0]).toMatchObject({ kind: 'video', className: '6', subject: 'Maths', mime: 'video/mp4' });
    // The class was made for them, once.
    expect((await app.inject({ method: 'GET', url: '/api/v1/classes', headers })).json().map((x: { name: string }) => x.name)).toEqual(['6']);
    // And the video plays: its bytes come back.
    const file = await app.inject({ method: 'GET', url: `/api/v1/files/${items[0].fileHash}/raw`, headers });
    expect(file.statusCode).toBe(200);
    expect(file.rawPayload.length).toBe(mp4(1).length);
  });

  it('puts the activities that come with the app in the library too', async () => {
    const dir = resolve(__dirname, '../../installer/activities');
    const files = Object.fromEntries(readdirSync(dir).map((f) => [f, readFileSync(join(dir, f))]));
    const { c, admin, library, diary } = await server({ ...files, 'G6-Mat-Not a page.html': Buffer.from('MZ a program') });
    const headers = await admin();
    expect(await c.starter!.sync()).toBe(true);
    const items = await library(headers);
    expect(items).toEqual([expect.objectContaining({ title: 'Addition practice', kind: 'activity', className: '6', subject: 'Maths', mime: 'text/html; charset=utf-8' })]);
    expect(diary.filter((l) => l.startsWith('starter.activity.added'))).toHaveLength(1);
    expect(diary.filter((l) => l.startsWith('starter.activity.skipped'))).toHaveLength(1);
  });

  it('adds each video once: not again on a restart, and not after the teacher removed it', async () => {
    const { c, admin, library, app } = await server({ [INTEGERS]: mp4(1) });
    const headers = await admin();
    await c.starter!.sync();
    await c.starter!.sync();
    const [item] = await library(headers);
    expect(await library(headers)).toHaveLength(1);
    expect((await app.inject({ method: 'DELETE', url: `/api/v1/content/${item.id}`, headers })).statusCode).toBe(204);
    await c.starter!.sync();
    expect(await library(headers)).toEqual([]);
  });

  it('uses a class that is already there, and leaves out what is not a video or has no class in its name', async () => {
    const { c, admin, library, app, diary } = await server({ [INTEGERS]: mp4(1), 'G6-Mat-Fake video.mp4': Buffer.from('MZ this is a program'), 'holiday.mp4': mp4(3), 'notes.txt': Buffer.from('hello') });
    const headers = await admin();
    await app.inject({ method: 'POST', url: '/api/v1/classes', headers, payload: { name: '6' } });
    expect(await c.starter!.sync()).toBe(true);
    expect((await library(headers)).map((i: { title: string }) => i.title)).toEqual(['Addition of Integers - Part 1']);
    expect((await app.inject({ method: 'GET', url: '/api/v1/classes', headers })).json()).toHaveLength(1);
    expect(diary.filter((l) => l.startsWith('starter.video.skipped'))).toHaveLength(2);
  });

  it('puts a book (PDF) in the library like a video, once, and skips a .pdf that is really a video', async () => {
    const pdf = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(500, 7)]);
    const { c, admin, library, diary } = await server({ 'G6-Eng-Sci-Our Book.pdf': pdf, 'G6-Eng-Sci-Fake Book.pdf': mp4(4) });
    const headers = await admin();
    expect(await c.starter!.sync()).toBe(true);
    await c.starter!.sync();
    const items = await library(headers);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ kind: 'pdf', className: '6', subject: 'Science', title: filingFromName('G6-Eng-Sci-Our Book.pdf')!.title });
    expect(diary.filter((l) => l.startsWith('starter.book.added'))).toHaveLength(1);
    expect(diary.filter((l) => l.startsWith('starter.book.skipped'))).toHaveLength(1);
    expect(diary.filter((l) => l.startsWith('starter.video.'))).toHaveLength(0);
  });

  // Our own videos are given out locked, so that the file plays in no other program.
  describe('locked videos', () => {
    const KEY = 'ab'.repeat(32);
    // A video big enough to be read in more than one piece, with nothing repeating in it.
    const video = Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom'), randomBytes(300_000)]);
    // Locked by the same tool that locks the real ones.
    const locked = (bytes: Buffer, key = KEY) => {
      const dir = mkdtempSync(join(tmpdir(), 'ict-lock-'));
      writeFileSync(join(dir, INTEGERS), bytes);
      execFileSync(process.execPath, [resolve(__dirname, '../../installer/lock-videos.mjs'), dir], { env: { ...process.env, ICT_CONTENT_KEY: key } });
      return readFileSync(join(dir, `${INTEGERS}.ictlock`));
    };

    it('plays a locked video in the app, whole and from any point, while the disk holds only the locked bytes', async () => {
      const onDisk = locked(video);
      expect(onDisk.includes(video.subarray(0, 12))).toBe(false);
      expect(onDisk.includes(video.subarray(5000, 5032))).toBe(false);

      const { c, admin, library, app, dataDir } = await server({ [`${INTEGERS}.ictlock`]: onDisk }, Buffer.from(KEY, 'hex'));
      const headers = await admin();
      expect(await c.starter!.sync()).toBe(true);
      const [item] = await library(headers);
      // Filed under the name it had before it was locked, with its real size.
      expect(item).toMatchObject({ title: 'Addition of Integers - Part 1', kind: 'video', mime: 'video/mp4', size: video.length, fileName: INTEGERS });

      const raw = `/api/v1/files/${item.fileHash}/raw`;
      const whole = await app.inject({ method: 'GET', url: raw, headers });
      expect(whole.rawPayload.equals(video)).toBe(true);
      // Skipping ahead: a part that starts and ends in the middle of the 16-byte blocks the lock works in.
      const part = await app.inject({ method: 'GET', url: raw, headers: { ...headers, range: 'bytes=100003-200010' } });
      expect(part.statusCode).toBe(206);
      expect(part.headers['content-range']).toBe(`bytes 100003-200010/${video.length}`);
      expect(part.rawPayload.equals(video.subarray(100003, 200011))).toBe(true);
      // The piece-by-piece way of reading gives the real bytes too.
      const piece = (await app.inject({ method: 'GET', url: `/api/v1/files/${item.fileHash}/chunks/0`, headers })).json();
      const first = Buffer.from(piece.data, 'base64');
      expect(first.equals(video.subarray(0, first.length))).toBe(true);

      // What the library keeps on the server's disk is still locked.
      const kept = join(dataDir, 'files', item.fileHash.slice(0, 2), item.fileHash);
      expect(readFileSync(kept).equals(onDisk)).toBe(true);
      expect(readdirSync(join(dataDir, 'uploads'))).toEqual([]);
    });

    it('leaves a locked video for later when the server has no key, and does not open one locked with another key', async () => {
      const noKey = await server({ [`${INTEGERS}.ictlock`]: locked(video) });
      const headers = await noKey.admin();
      expect(await noKey.c.starter!.sync()).toBe(true);
      expect(await noKey.library(headers)).toEqual([]);
      expect(noKey.diary.filter((l) => l.startsWith('starter.video.skipped'))).toHaveLength(1);

      const wrongKey = await server({ [`${INTEGERS}.ictlock`]: locked(video, 'cd'.repeat(32)) }, Buffer.from(KEY, 'hex'));
      const h = await wrongKey.admin();
      await wrongKey.c.starter!.sync();
      expect(await wrongKey.library(h)).toEqual([]);
      expect(wrongKey.diary.filter((l) => l.includes('it is not a video the app can play'))).toHaveLength(1);
    });
  });
});
