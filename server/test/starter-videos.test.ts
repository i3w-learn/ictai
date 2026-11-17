import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.js';
import { createContainer } from '../src/container.js';
import { openDb } from '../src/infra/db/index.js';
import { filingFromName } from '../src/modules/content/starter-videos.js';

const mp4 = (fill: number) => Buffer.concat([Buffer.from([0, 0, 0, 0x20]), Buffer.from('ftypisom'), Buffer.alloc(2000, fill)]);
const INTEGERS = 'G6-Mar-Mat-06Int11-Addition of Integers -Part 1-DMV-ILL.mp4';

// A server whose installer left `files` in the starter videos folder.
async function server(files: Record<string, Buffer>) {
  const dataDir = mkdtempSync(join(tmpdir(), 'ict-starter-'));
  const starterDir = join(dataDir, 'starter-videos');
  mkdirSync(starterDir);
  for (const [name, bytes] of Object.entries(files)) writeFileSync(join(starterDir, name), bytes);
  const diary: string[] = [];
  const c = createContainer({ db: openDb(':memory:'), now: () => 1_800_000_000_000, version: 'test', dataDir, starterDir, log: (event, d) => diary.push(`${event} ${JSON.stringify(d)}`) });
  c.identity.setCertFingerprint('AA:BB');
  const app = buildApp(c);
  await app.ready();
  const admin = async () => {
    await c.staffAuth.upsertAccount({ username: 'admin', password: 'admin-pass', role: 'super_admin' });
    const token = (await app.inject({ method: 'POST', url: '/api/v1/auth/staff', payload: { username: 'admin', password: 'admin-pass' } })).json().token;
    return { authorization: `Bearer ${token}` };
  };
  const library = async (headers: object) => (await app.inject({ method: 'GET', url: '/api/v1/content', headers: headers as Record<string, string> })).json();
  return { c, app, admin, library, diary, starterDir };
}

describe('videos that come with the app', () => {
  it('reads the class, subject and title from the file name', () => {
    expect(filingFromName(INTEGERS)).toEqual({ className: '6', subject: 'Maths', title: 'Addition of Integers - Part 1' });
    expect(filingFromName('G10-Eng-Sci-Light.mp4')).toEqual({ className: '10', subject: 'Science', title: 'Light' });
    expect(filingFromName('g07-Water cycle.webm')).toEqual({ className: '7', subject: null, title: 'Water cycle' });
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
});
