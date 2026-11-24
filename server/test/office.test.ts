import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';
import { CHUNK_BYTES } from '@ict/contracts';
import { LibreOffice, officeExt, type OfficeConverter } from '../src/modules/content/office.js';
import { testServer } from './helpers.js';

// The first bytes of the new formats (a zip file) and of the old ones.
const zip = (size = 600) => Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(size - 4, 3)]);
const old = (size = 600) => Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.alloc(size - 8, 4)]);

// Stands in for LibreOffice: "makes a PDF" that says which file it was made from.
function fakeOffice(opts: { installed?: boolean; fails?: boolean; notPdf?: boolean } = {}) {
  const seen: { ext: string; bytes: number }[] = [];
  const office: OfficeConverter = {
    installed: () => opts.installed ?? true,
    toPdf: async (file, ext, workDir) => {
      seen.push({ ext, bytes: readFileSync(file).length });
      if (opts.fails) throw new Error('soffice crashed');
      const out = join(workDir, 'in.pdf');
      writeFileSync(out, opts.notPdf ? 'not a pdf at all' : `%PDF-1.4\nmade from a ${ext} file\n`);
      return out;
    },
  };
  return { office, seen };
}

async function school(office?: OfficeConverter) {
  const t = await testServer({ office });
  const admin = t.auth(await t.login('admin', 'admin-pass'));
  const inject = (method: 'GET' | 'POST' | 'PUT', url: string, payload?: object) =>
    t.app.inject({ method, url, headers: admin, ...(payload ? { payload } : {}) });
  const c7 = (await inject('POST', '/api/v1/classes', { name: '7' })).json();
  const upload = async (bytes: Buffer, fileName: string, title = 'Water') => {
    const { uploadId, chunks } = (await inject('POST', '/api/v1/content/uploads', { fileName, size: bytes.length })).json();
    for (let i = 0; i < chunks; i++) await inject('PUT', `/api/v1/content/uploads/${uploadId}/chunks`, { index: i, data: bytes.subarray(i * CHUNK_BYTES, (i + 1) * CHUNK_BYTES).toString('base64') });
    return inject('POST', `/api/v1/content/uploads/${uploadId}/finish`, { title, classId: c7.id });
  };
  const read = async (hash: string) => Buffer.from((await inject('GET', `/api/v1/files/${hash}/chunks/0`)).json().data, 'base64').toString();
  return { ...t, admin, inject, upload, read };
}

describe('telling an Office file from its name and first bytes', () => {
  it('knows the new and the old formats', () => {
    for (const ext of ['docx', 'xlsx', 'pptx']) expect(officeExt(zip(), `Lesson 1.${ext.toUpperCase()}`)).toBe(ext);
    for (const ext of ['doc', 'xls', 'ppt']) expect(officeExt(old(), `lesson.${ext}`)).toBe(ext);
  });

  it('is not fooled by a name alone, or by a zip with another name', () => {
    expect(officeExt(Buffer.from('MZ this is a program'), 'virus.docx')).toBeNull();
    expect(officeExt(old(), 'lesson.docx')).toBeNull();
    expect(officeExt(zip(), 'lesson.doc')).toBeNull();
    expect(officeExt(zip(), 'things.zip')).toBeNull();
    expect(officeExt(zip(), 'no-ending')).toBeNull();
  });
});

describe('Word, Excel and PowerPoint files in the library', () => {
  it('turns the file into a PDF and keeps the PDF', async () => {
    const { office, seen } = fakeOffice();
    const { upload, read, inject } = await school(office);
    const res = await upload(zip(700), 'Water cycle.pptx');
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ kind: 'pdf', mime: 'application/pdf', fileName: 'Water cycle.pptx', title: 'Water' });
    expect(seen).toEqual([{ ext: 'pptx', bytes: 700 }]);
    expect(await read(res.json().fileHash)).toBe('%PDF-1.4\nmade from a pptx file\n');
    expect((await inject('GET', '/api/v1/content')).json()).toHaveLength(1);
  });

  it('works for the old formats too, and for a file sent in several pieces', async () => {
    const { office, seen } = fakeOffice();
    const { upload } = await school(office);
    expect((await upload(old(CHUNK_BYTES + 500), 'marks.xls')).json()).toMatchObject({ kind: 'pdf' });
    expect(seen).toEqual([{ ext: 'xls', bytes: CHUNK_BYTES + 500 }]);
  });

  it('leaves nothing behind on the disk but the PDF', async () => {
    const { office } = fakeOffice();
    const { upload, c } = await school(office);
    await upload(zip(), 'a.docx');
    const store = (c.content as unknown as { store: { pendingParts(): number } }).store;
    expect(store.pendingParts()).toBe(0);
  });

  it('says plainly that LibreOffice is missing, and adds nothing', async () => {
    for (const office of [undefined, fakeOffice({ installed: false }).office]) {
      const { upload, inject } = await school(office);
      const res = await upload(zip(), 'lesson.docx');
      expect(res.statusCode).toBe(415);
      expect(res.json().code).toBe('OFFICE_NOT_INSTALLED');
      expect(res.json().message).toMatch(/LibreOffice.*Server PC/);
      expect((await inject('GET', '/api/v1/content')).json()).toEqual([]);
    }
  });

  it('says so when the file cannot be turned into a PDF, and adds nothing', async () => {
    for (const how of [{ fails: true }, { notPdf: true }]) {
      const { upload, inject, c } = await school(fakeOffice(how).office);
      const res = await upload(zip(), 'broken.docx');
      expect(res.statusCode, JSON.stringify(how)).toBe(how.fails ? 422 : 415);
      expect((await inject('GET', '/api/v1/content')).json()).toEqual([]);
      expect((c.content as unknown as { store: { pendingParts(): number } }).store.pendingParts()).toBe(0);
    }
  });

  it('still refuses a program or a plain zip, whatever it is called', async () => {
    const { office, seen } = fakeOffice();
    const { upload } = await school(office);
    expect((await upload(Buffer.from('MZ' + 'x'.repeat(500)), 'game.docx')).statusCode).toBe(415);
    expect((await upload(zip(), 'things.zip')).statusCode).toBe(415);
    expect(seen).toEqual([]);
  });

  it('does not send a PDF, a picture or a video through LibreOffice', async () => {
    const { office, seen } = fakeOffice();
    const { upload } = await school(office);
    expect((await upload(Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(300, 32)]), 'notes.pdf')).json()).toMatchObject({ kind: 'pdf' });
    expect(seen).toEqual([]);
  });
});

describe('running LibreOffice', () => {
  const setup = (opts: { makesPdf?: boolean; has?: (p: string) => boolean } = {}) => {
    const runs: { bin: string; args: string[]; timeoutMs: number }[] = [];
    const made = new Set<string>();
    const run = async (bin: string, args: string[], timeoutMs: number) => {
      runs.push({ bin, args, timeoutMs });
      if (opts.makesPdf !== false) made.add(join(args[args.indexOf('--outdir') + 1]!, 'in.pdf'));
    };
    const exists = (p: string) => made.has(p) || (opts.has ? opts.has(p) : p === '/opt/lo/soffice') || existsSync(p);
    // A space in the path, as in "C:\\ProgramData\\ICT App".
    const profile = join(mkdtempSync(join(tmpdir(), 'ict data ')), 'office');
    return { runs, profile, office: (bin: string | null) => new LibreOffice(bin, profile, run, exists) };
  };

  it('is not installed when its program is not there', () => {
    expect(setup().office('/nowhere/soffice').installed()).toBe(false);
    expect(setup().office('/opt/lo/soffice').installed()).toBe(true);
  });

  it('gives LibreOffice a copy named for what the file is, its own settings folder, and a time limit', async () => {
    const t = await testServer();
    const store = (t.c.content as unknown as { store: { workDir(): { dir: string; remove(): void }; newPart(): string; append(id: string, b: Buffer): void; partFile(id: string): string } }).store;
    const part = store.newPart();
    store.append(part, zip(300));
    const work = store.workDir();
    const { runs, profile, office } = setup();
    const pdf = await office('/opt/lo/soffice').toPdf(store.partFile(part), 'docx', work.dir);
    expect(pdf).toBe(join(work.dir, 'in.pdf'));
    expect(readFileSync(join(work.dir, 'in.docx')).length).toBe(300);
    const { bin, args, timeoutMs } = runs[0]!;
    expect(bin).toBe('/opt/lo/soffice');
    expect(args).toContain('--headless');
    // The space in the path is written the way a file address needs it, and the folder is made.
    expect(args).toContain(`-env:UserInstallation=${pathToFileURL(profile).href}`);
    expect(pathToFileURL(profile).href).toContain('ict%20data%20');
    expect(existsSync(profile)).toBe(true);
    expect(args.slice(-5)).toEqual(['--convert-to', 'pdf', '--outdir', work.dir, join(work.dir, 'in.docx')]);
    expect(timeoutMs).toBe(120_000);
    work.remove();
    expect(existsSync(work.dir)).toBe(false);
  });

  it('fails when LibreOffice ends without making a PDF', async () => {
    const t = await testServer();
    const store = (t.c.content as unknown as { store: { workDir(): { dir: string; remove(): void }; newPart(): string; append(id: string, b: Buffer): void; partFile(id: string): string } }).store;
    const part = store.newPart();
    store.append(part, zip(300));
    const work = store.workDir();
    await expect(setup({ makesPdf: false }).office('/opt/lo/soffice').toPdf(store.partFile(part), 'docx', work.dir)).rejects.toThrow(/without making a PDF/);
    work.remove();
  });
});
