import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { MAX_FILE_BYTES, CHUNK_BYTES, STREAM_WINDOW_BYTES, rangeOf } from '@ict/contracts';
import { DISK_RESERVE_BYTES } from '../src/modules/content/content.service.js';
import { testServer } from './helpers.js';

const pdf = (size: number, fill = 0x20) => Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(size - 9, fill)]);
const png = (size: number) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(size - 8, 7)]);
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');

// Class 7 (Asha) and Class 8 (Kabir). Ravi teaches Maths to Class 7 and may upload; Tara may not upload.
async function school() {
  const t = await testServer();
  const admin = t.auth(await t.login('admin', 'admin-pass'));
  const inject = (method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', url: string, headers: object, payload?: object) =>
    t.app.inject({ method, url, headers: headers as Record<string, string>, ...(payload ? { payload } : {}) });
  const c7 = (await inject('POST', '/api/v1/classes', admin, { name: '7' })).json();
  const c8 = (await inject('POST', '/api/v1/classes', admin, { name: '8' })).json();
  const student = async (name: string, classId: string) => {
    await inject('POST', '/api/v1/students', admin, { name, classId, rollNo: '1' });
    const device = t.auth(await t.enrolDevice('lab_pc'));
    return t.auth((await inject('POST', '/api/v1/auth/student/roll', device, { classId, rollNo: '1' })).json().token);
  };
  const asha = await student('Asha', c7.id);
  const kabir = await student('Kabir', c8.id);
  await inject('POST', '/api/v1/staff', admin, { username: 'ravi', displayName: 'Ravi K', password: 'ravi-pass1', classIds: [c7.id], subjects: ['Maths'] });
  const ravi = t.auth(await t.login('ravi', 'ravi-pass1'));

  // Sends a file the way the app does: start, every piece in order, finish.
  const upload = async (who: object, bytes: Buffer, filing: object, fileName = 'file.bin') => {
    const start = await inject('POST', '/api/v1/content/uploads', who, { fileName, size: bytes.length });
    if (start.statusCode !== 201) return start;
    const { uploadId, chunks } = start.json();
    for (let i = 0; i < chunks; i++) {
      const piece = await inject('PUT', `/api/v1/content/uploads/${uploadId}/chunks`, who, { index: i, data: bytes.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES).toString('base64') });
      if (piece.statusCode !== 204) return piece;
    }
    return inject('POST', `/api/v1/content/uploads/${uploadId}/finish`, who, filing);
  };
  // Reads a whole file back piece by piece.
  const download = async (who: object, hash: string) => {
    const parts: Buffer[] = [];
    for (let i = 0; ; i++) {
      const res = await inject('GET', `/api/v1/files/${hash}/chunks/${i}`, who);
      if (res.statusCode !== 200) return res.statusCode;
      parts.push(Buffer.from(res.json().data, 'base64'));
      if (res.json().last) return Buffer.concat(parts);
    }
  };
  return { ...t, inject, admin, ravi, c7, c8, asha, kabir, upload, download };
}

describe('Content library', () => {
  it('takes a file in pieces, files it, and gives it back byte for byte', async () => {
    const { admin, c7, asha, upload, download } = await school();
    const bytes = png(CHUNK_BYTES * 2 + 12_345); // three pieces
    const res = await upload(admin, bytes, { title: ' Water cycle diagram ', classId: c7.id, subject: 'Science', chapter: 'Water' }, 'cycle.png');
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      title: 'Water cycle diagram', kind: 'image', mime: 'image/png', className: '7', subject: 'Science', chapter: 'Water',
      fileHash: sha(bytes), fileName: 'cycle.png', size: bytes.length, url: null, needsInternet: false,
    });
    const back = await download(asha, sha(bytes));
    expect(Buffer.isBuffer(back) && back.equals(bytes)).toBe(true);
  });

  it('knows a file by its first bytes, not its name, and refuses what the library cannot show', async () => {
    const { admin, c7, upload } = await school();
    const filing = { title: 'File', classId: c7.id };
    expect((await upload(admin, pdf(2000), filing, 'really-a-pdf.exe')).json()).toMatchObject({ kind: 'pdf', mime: 'application/pdf' });
    const program = Buffer.concat([Buffer.from('MZ'), Buffer.alloc(500)]);
    const refused = await upload(admin, program, filing, 'notes.pdf');
    expect(refused.statusCode).toBe(415);
    expect(refused.json().code).toBe('UNSUPPORTED_FILE');
  });

  it('keeps one copy of a file uploaded twice, and removes it only when the last item goes', async () => {
    const { inject, admin, c7, c8, asha, upload, download, db } = await school();
    const bytes = pdf(5000);
    const a = (await upload(admin, bytes, { title: 'For 7', classId: c7.id })).json();
    const b = (await upload(admin, bytes, { title: 'For 8', classId: c8.id })).json();
    expect(a.fileHash).toBe(b.fileHash);
    expect(db.prepare('SELECT COUNT(*) FROM files').pluck().get()).toBe(1);

    expect((await inject('DELETE', `/api/v1/content/${b.id}`, admin)).statusCode).toBe(204);
    expect(Buffer.isBuffer(await download(asha, a.fileHash))).toBe(true); // Class 7 still has it
    expect((await inject('DELETE', `/api/v1/content/${a.id}`, admin)).statusCode).toBe(204);
    expect(await download(admin, a.fileHash)).toBe(404);
    expect(db.prepare('SELECT COUNT(*) FROM files').pluck().get()).toBe(0);
  });

  it("lets a student open only files in their own class's library", async () => {
    const { admin, c7, asha, kabir, upload, download } = await school();
    const item = (await upload(admin, pdf(3000), { title: 'Class 7 book', classId: c7.id })).json();
    expect(Buffer.isBuffer(await download(asha, item.fileHash))).toBe(true);
    expect(await download(kabir, item.fileHash)).toBe(404);
    expect(await download({}, item.fileHash)).toBe(401);
  });

  it('adds a web link and marks it as needing internet', async () => {
    const { inject, admin, c7 } = await school();
    const res = await inject('POST', '/api/v1/content/links', admin, { title: 'Solar system video', url: 'https://example.org/solar', classId: c7.id, subject: 'Science' });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ kind: 'link', url: 'https://example.org/solar', needsInternet: true, fileHash: null, size: null });
    expect((await inject('POST', '/api/v1/content/links', admin, { title: 'Bad', url: 'javascript:alert(1)', classId: c7.id })).statusCode).toBe(400);
    expect((await inject('POST', '/api/v1/content/links', admin, { title: 'Bad', url: 'example.org', classId: c7.id })).statusCode).toBe(400);
  });

  it("shows a student their class's library in filing order", async () => {
    const { inject, admin, c7, c8, asha, upload } = await school();
    await upload(admin, pdf(1000, 1), { title: 'Fractions', classId: c7.id, subject: 'Maths', chapter: 'Numbers' });
    await upload(admin, pdf(1000, 2), { title: 'Plants', classId: c7.id, subject: 'Science', chapter: 'Life' });
    await upload(admin, pdf(1000, 3), { title: 'Decimals', classId: c7.id, subject: 'Maths', chapter: 'Numbers' });
    await upload(admin, pdf(1000, 4), { title: 'Other class', classId: c8.id });
    const mine = (await inject('GET', '/api/v1/content/mine', asha)).json();
    expect(mine.map((i: { subject: string; title: string }) => `${i.subject}/${i.title}`)).toEqual(['Maths/Decimals', 'Maths/Fractions', 'Science/Plants']);
  });

  it('refuses pieces out of order, a file bigger or smaller than promised, and an empty or huge file', async () => {
    const { inject, admin, c7 } = await school();
    const start = async (size: number) => (await inject('POST', '/api/v1/content/uploads', admin, { fileName: 'a.pdf', size })).json();
    const piece = (id: string, index: number, bytes: Buffer) => inject('PUT', `/api/v1/content/uploads/${id}/chunks`, admin, { index, data: bytes.toString('base64') });

    const a = await start(CHUNK_BYTES + 10);
    expect((await piece(a.uploadId, 1, pdf(10))).json()).toMatchObject({ code: 'OUT_OF_ORDER' });

    const b = await start(100);
    expect((await piece(b.uploadId, 0, pdf(200))).statusCode).toBe(400); // more than promised
    expect((await piece(b.uploadId, 0, pdf(100))).statusCode).toBe(404); // that upload was thrown away

    const c = await start(100);
    await piece(c.uploadId, 0, pdf(60));
    expect((await inject('POST', `/api/v1/content/uploads/${c.uploadId}/finish`, admin, { title: 'Short', classId: c7.id })).statusCode).toBe(400);

    expect((await inject('POST', '/api/v1/content/uploads', admin, { fileName: 'a.pdf', size: 0 })).statusCode).toBe(400);
    expect((await inject('POST', '/api/v1/content/uploads', admin, { fileName: 'a.pdf', size: MAX_FILE_BYTES + 1 })).statusCode).toBe(400);
  });

  it('keeps a teacher to her own classes and subjects, and one teacher out of another upload', async () => {
    const { inject, admin, ravi, c7, c8, upload } = await school();
    expect((await upload(ravi, pdf(1000, 1), { title: 'Mine', classId: c7.id, subject: 'Maths' })).statusCode).toBe(201);
    expect((await upload(ravi, pdf(1000, 2), { title: 'Not my class', classId: c8.id, subject: 'Maths' })).statusCode).toBe(403);
    expect((await upload(ravi, pdf(1000, 3), { title: 'Not my subject', classId: c7.id, subject: 'Science' })).statusCode).toBe(403);
    const science = (await upload(admin, pdf(1000, 4), { title: 'Science book', classId: c7.id, subject: 'Science' })).json();
    expect((await inject('GET', '/api/v1/content', ravi)).json().map((i: { title: string }) => i.title)).toEqual(['Mine']);
    expect((await inject('DELETE', `/api/v1/content/${science.id}`, ravi)).statusCode).toBe(404);
    expect((await inject('GET', `/api/v1/content?classId=${c8.id}`, ravi)).statusCode).toBe(403);
    // Ravi cannot add pieces to an upload the admin started.
    const started = (await inject('POST', '/api/v1/content/uploads', admin, { fileName: 'a.pdf', size: 50 })).json();
    expect((await inject('PUT', `/api/v1/content/uploads/${started.uploadId}/chunks`, ravi, { index: 0, data: pdf(50).toString('base64') })).statusCode).toBe(404);
  });

  it('needs the upload permission, which the Super Admin can switch off for a teacher', async () => {
    const { inject, admin, ravi, c7, upload } = await school();
    const staff = (await inject('GET', '/api/v1/staff', admin)).json().find((s: { username: string }) => s.username === 'ravi');
    await inject('PATCH', `/api/v1/staff/${staff.id}`, admin, { canUploadContent: false });
    expect((await upload(ravi, pdf(1000), { title: 'Mine', classId: c7.id, subject: 'Maths' })).statusCode).toBe(403);
    expect((await inject('POST', '/api/v1/content/links', ravi, { title: 'L', url: 'https://example.org/x', classId: c7.id, subject: 'Maths' })).statusCode).toBe(403);
    expect((await inject('GET', '/api/v1/content', ravi)).statusCode).toBe(200); // she can still read the library
  });

  it('is closed to students for adding and removing', async () => {
    const { inject, admin, c7, asha, upload } = await school();
    const item = (await upload(admin, pdf(1000), { title: 'Book', classId: c7.id })).json();
    expect((await upload(asha, pdf(1000), { title: 'Mine', classId: c7.id })).statusCode).toBe(403);
    expect((await inject('DELETE', `/api/v1/content/${item.id}`, asha)).statusCode).toBe(403);
    expect((await inject('GET', '/api/v1/content', asha)).statusCode).toBe(403);
    expect((await inject('GET', '/api/v1/content/mine', admin)).statusCode).toBe(403);
  });

  it('streams a file: the whole of it, or only the part a Range header asks for', async () => {
    const { inject, admin, c7, asha, kabir, upload } = await school();
    const bytes = Buffer.concat([png(1000), Buffer.from('the tail of the file')]);
    const hash = sha(bytes);
    await upload(admin, bytes, { title: 'Picture', classId: c7.id });
    const get = (who: object, range?: string) => inject('GET', `/api/v1/files/${hash}/raw`, { ...who, ...(range ? { range } : {}) });

    const whole = await get(asha);
    expect(whole.statusCode).toBe(200);
    expect(whole.headers).toMatchObject({ 'content-type': 'image/png', 'accept-ranges': 'bytes', 'content-length': String(bytes.length) });
    expect(whole.rawPayload.equals(bytes)).toBe(true);

    const part = await get(asha, 'bytes=10-19');
    expect(part.statusCode).toBe(206);
    expect(part.headers['content-range']).toBe(`bytes 10-19/${bytes.length}`);
    expect(part.rawPayload.equals(bytes.subarray(10, 20))).toBe(true);
    expect((await get(asha, 'bytes=1000-')).rawPayload.toString()).toBe('the tail of the file');
    expect((await get(asha, 'bytes=-4')).rawPayload.toString()).toBe('file');

    const past = await get(asha, `bytes=${bytes.length}-`);
    expect(past.statusCode).toBe(416);
    expect(past.headers['content-range']).toBe(`bytes */${bytes.length}`);
    // The same rules as the piece-by-piece route: another class's student, and nobody signed in, get nothing.
    expect((await get(kabir)).statusCode).toBe(404);
    expect((await get({})).statusCode).toBe(401);
  });

  it('answers an open-ended range with one window, so a big video is never sent in one go', () => {
    const size = STREAM_WINDOW_BYTES * 3;
    expect(rangeOf('bytes=0-', size)).toEqual({ start: 0, end: STREAM_WINDOW_BYTES - 1 });
    expect(rangeOf(`bytes=${size - 10}-`, size)).toEqual({ start: size - 10, end: size - 1 });
    expect(rangeOf('bytes=5-2', size)).toBe('bad');
    expect(rangeOf(undefined, size)).toBeNull();
    expect(rangeOf('lines=1-2', size)).toBeNull();
  });

  it('lets one person send two files at once, not more, and refuses a file the disk has no room for', async () => {
    const { inject, admin, ravi, c } = await school();
    const start = (who: object, size = 50) => inject('POST', '/api/v1/content/uploads', who, { fileName: 'a.pdf', size });
    expect((await start(admin)).statusCode).toBe(201);
    expect((await start(admin)).statusCode).toBe(201);
    const third = await start(admin);
    expect(third.statusCode).toBe(429);
    expect(third.json().message).toBe('You are already sending 2 files. Wait for one to finish.');
    expect((await start(ravi)).statusCode).toBe(201);

    // A disk with just under the reserve plus this file left over.
    const store = (c.content as unknown as { store: { freeBytes(): number } }).store;
    store.freeBytes = () => DISK_RESERVE_BYTES + 1000;
    const full = await start(ravi, 1000);
    expect(full.statusCode).toBe(507);
    expect(full.json()).toMatchObject({ code: 'DISK_FULL' });
    store.freeBytes = () => DISK_RESERVE_BYTES + 1000 + 150; // room for this file and the three under way
    expect((await start(ravi, 1000)).statusCode).toBe(201);
  });
});
