import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ActivityDone, CHUNK_BYTES } from '@ict/contracts';
import { isActivity } from '../src/modules/content/sniff.js';
import { testServer } from './helpers.js';

const page = (body = 'A game') => Buffer.from(`<!doctype html>\n<html><body>${body}<script>parent.postMessage({ict:'activity',type:'done',score:1,max:1},'*')</script></body></html>`);

// Class 7 has Asha (roll 1), Bina (roll 2) and Chand (roll 10); Class 8 has Kabir. Ravi teaches Maths to Class 7.
async function school() {
  const t = await testServer();
  const admin = t.auth(await t.login('admin', 'admin-pass'));
  const inject = (method: 'GET' | 'POST' | 'PUT', url: string, headers: object, payload?: object) =>
    t.app.inject({ method, url, headers: headers as Record<string, string>, ...(payload ? { payload } : {}) });
  const c7 = (await inject('POST', '/api/v1/classes', admin, { name: '7' })).json();
  const c8 = (await inject('POST', '/api/v1/classes', admin, { name: '8' })).json();
  const student = async (name: string, classId: string, rollNo: string) => {
    const s = (await inject('POST', '/api/v1/students', admin, { name, classId, rollNo })).json();
    return t.auth(await t.studentToken(s.id));
  };
  const chand = await student('Chand', c7.id, '10');
  const asha = await student('Asha', c7.id, '1');
  const bina = await student('Bina', c7.id, '2');
  const kabir = await student('Kabir', c8.id, '1');
  await inject('POST', '/api/v1/staff', admin, { username: 'ravi', displayName: 'Ravi K', password: 'ravi-pass1', classIds: [c7.id], subjects: ['Maths'] });
  const ravi = t.auth(await t.login('ravi', 'ravi-pass1'));
  const upload = async (bytes: Buffer, fileName: string, filing: object) => {
    const { uploadId, chunks } = (await inject('POST', '/api/v1/content/uploads', admin, { fileName, size: bytes.length })).json();
    for (let i = 0; i < chunks; i++) await inject('PUT', `/api/v1/content/uploads/${uploadId}/chunks`, admin, { index: i, data: bytes.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES).toString('base64') });
    return inject('POST', `/api/v1/content/uploads/${uploadId}/finish`, admin, filing);
  };
  const game = (await upload(page(), 'Sums.html', { title: 'Sums', classId: c7.id, subject: 'Maths' })).json();
  const done = (who: object, id: string, score: number, max = 10, seconds = 30) => inject('POST', `/api/v1/activities/${id}/results`, who, { score, max, seconds });
  const scores = async (who: object, id = game.id) => (await inject('GET', `/api/v1/activities/${id}/results`, who)).json();
  return { ...t, inject, admin, ravi, c7, c8, asha, bina, chand, kabir, upload, game, done, scores };
}

describe('telling an activity from its name and first letters', () => {
  it('takes a web page file, with or without the mark some editors put first', () => {
    expect(isActivity(Buffer.from('<!DOCTYPE html><html>'), 'game.html')).toBe(true);
    expect(isActivity(Buffer.from('﻿  \n<html lang="en">'), 'GAME.HTM')).toBe(true);
  });

  it('refuses another kind of file named .html, and a web page with another name', () => {
    expect(isActivity(Buffer.from('MZ this is a program'), 'game.html')).toBe(false);
    expect(isActivity(Buffer.from('%PDF-1.4'), 'book.html')).toBe(false);
    expect(isActivity(Buffer.from('<!doctype html>'), 'game.txt')).toBe(false);
  });
});

describe('Activities', () => {
  it('go into the library as their own kind, and students of the class see them', async () => {
    const { inject, game, asha, kabir } = await school();
    expect(game).toMatchObject({ kind: 'activity', mime: 'text/html; charset=utf-8', fileName: 'Sums.html', title: 'Sums', className: '7' });
    expect((await inject('GET', '/api/v1/content/mine', asha)).json().map((i: { kind: string }) => i.kind)).toEqual(['activity']);
    expect((await inject('GET', '/api/v1/content/mine', kabir)).json()).toEqual([]);
  });

  it('are served in a closed box: no address of their own, nothing loaded from anywhere else', async () => {
    const { app, game, asha, admin, upload, c7 } = await school();
    const res = await app.inject({ method: 'GET', url: `/api/v1/files/${game.fileHash}/raw`, headers: asha as Record<string, string> });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8');
    const csp = String(res.headers['content-security-policy']);
    expect(csp).toMatch(/^sandbox allow-scripts;/);
    expect(csp).not.toMatch(/allow-same-origin|allow-top-navigation|allow-popups|allow-forms/);
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toMatch(/https?:|\*/);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.body).toBe(page().toString());
    // Other kinds of file are served as before, with no such rule.
    const pdf = (await upload(Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(100, 32)]), 'b.pdf', { title: 'Book', classId: c7.id })).json();
    expect((await app.inject({ method: 'GET', url: `/api/v1/files/${pdf.fileHash}/raw`, headers: admin })).headers['content-security-policy']).toBeUndefined();
  });

  it('keep every try and show the teacher each student\'s best, in roll order', async () => {
    const { game, asha, bina, done, scores, admin, clock } = await school();
    expect((await done(asha, game.id, 4)).json()).toEqual({ best: 4, max: 10, tries: 1 });
    clock.t += 60_000;
    expect((await done(asha, game.id, 9)).json()).toEqual({ best: 9, max: 10, tries: 2 });
    clock.t += 60_000;
    const third = await done(asha, game.id, 6);
    expect(third.statusCode).toBe(201);
    expect(third.json()).toEqual({ best: 9, max: 10, tries: 3 });
    await done(bina, game.id, 10);

    expect(await scores(admin)).toEqual({
      title: 'Sums', className: '7',
      rows: [
        { studentId: expect.any(String), name: 'Asha', rollNo: '1', best: 9, max: 10, tries: 3, lastAt: clock.t },
        { studentId: expect.any(String), name: 'Bina', rollNo: '2', best: 10, max: 10, tries: 1, lastAt: clock.t },
        { studentId: expect.any(String), name: 'Chand', rollNo: '10', best: null, max: null, tries: 0, lastAt: null },
      ],
    });
  });

  it('judge the best try by the share of the marks, when the most there is changes', async () => {
    const { game, asha, done } = await school();
    await done(asha, game.id, 4, 5);
    expect((await done(asha, game.id, 6, 10)).json()).toMatchObject({ best: 4, max: 5 });
  });

  it('refuse a score that makes no sense', async () => {
    const { game, asha, done, inject } = await school();
    expect((await done(asha, game.id, 11, 10)).statusCode).toBe(400);
    expect((await done(asha, game.id, -1)).statusCode).toBe(400);
    expect((await done(asha, game.id, 1, 0)).statusCode).toBe(400);
    expect((await done(asha, game.id, 1.5)).statusCode).toBe(400);
    expect((await inject('POST', `/api/v1/activities/${game.id}/results`, asha, { score: 1 })).statusCode).toBe(400);
  });

  it('take a score only for an activity of the student\'s own class', async () => {
    const { game, kabir, asha, done, upload, c7 } = await school();
    expect((await done(kabir, game.id, 5)).statusCode).toBe(404);
    expect((await done(asha, '00000000-0000-4000-8000-000000000000', 5)).statusCode).toBe(404);
    // A book is not an activity.
    const pdf = (await upload(Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(100, 32)]), 'b.pdf', { title: 'Book', classId: c7.id })).json();
    expect((await done(asha, pdf.id, 5)).statusCode).toBe(404);
  });

  it('keep students and staff to their own sides, and a teacher to her classes and subjects', async () => {
    const { inject, game, asha, admin, ravi, done, scores, upload, c7, c8 } = await school();
    expect((await inject('GET', `/api/v1/activities/${game.id}/results`, asha)).statusCode).toBe(403);
    expect((await done(admin, game.id, 5)).statusCode).toBe(403);
    expect((await scores(ravi)).title).toBe('Sums');
    const other = (await upload(page('8'), 'Other.html', { title: 'For 8', classId: c8.id })).json();
    const science = (await upload(page('sci'), 'Sci.html', { title: 'Science game', classId: c7.id, subject: 'Science' })).json();
    expect((await inject('GET', `/api/v1/activities/${other.id}/results`, ravi)).statusCode).toBe(404);
    expect((await inject('GET', `/api/v1/activities/${science.id}/results`, ravi)).statusCode).toBe(404);
  });

  it('cannot be shown to the class like a video', async () => {
    const { inject, game, admin } = await school();
    expect((await inject('POST', '/api/v1/shows', admin, { contentId: game.id })).statusCode).toBe(400);
  });
});

describe('the message an activity sends', () => {
  it('is taken when it is whole and makes sense, and nothing else is', () => {
    expect(ActivityDone.safeParse({ ict: 'activity', type: 'done', score: 8, max: 10 }).success).toBe(true);
    for (const bad of [{ type: 'done', score: 8, max: 10 }, { ict: 'activity', type: 'done', score: 11, max: 10 }, { ict: 'activity', type: 'done', score: '8', max: 10 }, { ict: 'activity', type: 'start' }, 'done', null]) {
      expect(ActivityDone.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe('the activities that come with the app', () => {
  const dir = resolve(__dirname, '../../installer/activities');
  it('are each one web page file that loads nothing from outside and reports a score', () => {
    const files = readdirSync(dir);
    expect(files.length).toBeGreaterThan(0);
    for (const f of files) {
      const text = readFileSync(resolve(dir, f), 'utf8');
      expect(isActivity(Buffer.from(text.slice(0, 64)), f), f).toBe(true);
      expect(text, f).not.toMatch(/(src|href)\s*=\s*["']?(https?:)?\/\//i);
      expect(text, f).toMatch(/postMessage\(\{\s*ict:\s*'activity',\s*type:\s*'done'/);
    }
  });
});
