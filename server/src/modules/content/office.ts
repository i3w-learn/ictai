import { execFile } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync } from 'node:fs';
import { constants, setPriority } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { OFFICE_EXTENSIONS } from '@ict/contracts';

// Spec 4.2: Word, Excel and PowerPoint files are turned into a PDF on the server, and the library
// keeps the PDF. Every screen that shows a PDF (the viewer, Show to class, the pen) then works for
// them with nothing new to build.
// The turning is done by LibreOffice, a free office program that must be installed on the Server PC.
// It is not part of our installer (it is about 350 MB). Without it the server runs as before and
// says plainly why an Office file cannot be added.
export interface OfficeConverter {
  installed(): boolean;
  // Makes a PDF of `file` inside `workDir` (an empty folder the caller owns) and returns its path.
  toPdf(file: string, ext: string, workDir: string): Promise<string>;
}

export const noOffice: OfficeConverter = {
  installed: () => false,
  toPdf: () => Promise.reject(new Error('LibreOffice is not installed.')),
};

// A file is an Office file when its name says so and its first bytes agree: the new formats
// (.docx, .xlsx, .pptx) are zip files, the old ones (.doc, .xls, .ppt) start with their own mark.
// Returns the ending in small letters, or null.
export function officeExt(head: Buffer, fileName: string): string | null {
  const ext = /\.([a-z0-9]+)$/i.exec(fileName)?.[1]?.toLowerCase();
  if (!ext || !(OFFICE_EXTENSIONS as readonly string[]).includes(ext)) return null;
  const zip = head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04;
  const old = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].every((b, i) => head[i] === b);
  return (ext.endsWith('x') ? zip : old) ? ext : null;
}

// Where LibreOffice puts its program. On Windows soffice.com is the one that waits until the work
// is done and says whether it went well; soffice.exe only starts it.
function candidates(): string[] {
  if (process.platform === 'win32') {
    const roots = [process.env.ProgramFiles, process.env['ProgramFiles(x86)'], process.env.ProgramW6432].filter((r): r is string => !!r);
    return roots.flatMap((r) => [join(r, 'LibreOffice', 'program', 'soffice.com'), join(r, 'LibreOffice', 'program', 'soffice.exe')]);
  }
  if (process.platform === 'darwin') return ['/Applications/LibreOffice.app/Contents/MacOS/soffice'];
  return ['/usr/bin/soffice', '/usr/local/bin/soffice', '/opt/libreoffice/program/soffice'];
}

type Run = (bin: string, args: string[], timeoutMs: number) => Promise<void>;
const runProgram: Run = (bin, args, timeoutMs) =>
  new Promise((resolve, reject) => {
    const child = execFile(bin, args, { timeout: timeoutMs, windowsHide: true }, (err) => (err ? reject(err) : resolve()));
    // Low priority, so a live lesson always wins the processor.
    try { if (child.pid) setPriority(child.pid, constants.priority.PRIORITY_LOW); } catch { /* it has already ended */ }
  });

// A big slide deck can take a minute. Past this the file is given up on.
export const OFFICE_TIMEOUT_MS = 2 * 60_000;

export class LibreOffice implements OfficeConverter {
  // One file at a time: LibreOffice is heavy, and two at once fight over its settings folder.
  private line: Promise<unknown> = Promise.resolve();

  constructor(
    // ICT_OFFICE_BIN, for a LibreOffice that is somewhere unusual. Otherwise the usual places are tried.
    private readonly binOverride: string | null,
    // LibreOffice's own settings folder. The server runs as a Windows service with no user signed
    // in, so there is no user folder for it to use; it gets this one, inside the server's data.
    private readonly profileDir: string,
    private readonly run: Run = runProgram,
    private readonly exists: (path: string) => boolean = existsSync,
  ) {}

  private bin(): string | null {
    if (this.binOverride) return this.exists(this.binOverride) ? this.binOverride : null;
    return candidates().find((c) => this.exists(c)) ?? null;
  }

  installed(): boolean {
    return this.bin() !== null;
  }

  toPdf(file: string, ext: string, workDir: string): Promise<string> {
    const next = this.line.then(() => this.convert(file, ext, workDir));
    this.line = next.catch(() => undefined);
    return next;
  }

  private async convert(file: string, ext: string, workDir: string): Promise<string> {
    const bin = this.bin();
    if (!bin) throw new Error('LibreOffice is not installed.');
    mkdirSync(this.profileDir, { recursive: true });
    // LibreOffice picks how to read a file from the ending of its name, so it gets a copy named for what it is.
    const input = join(workDir, `in.${ext}`);
    copyFileSync(file, input);
    await this.run(bin, [
      '--headless', '--norestore', '--nolockcheck', '--nodefault', '--nofirststartwizard',
      `-env:UserInstallation=${pathToFileURL(this.profileDir).href}`,
      '--convert-to', 'pdf', '--outdir', workDir, input,
    ], OFFICE_TIMEOUT_MS);
    const pdf = join(workDir, 'in.pdf');
    if (!this.exists(pdf)) throw new Error('LibreOffice ended without making a PDF.');
    return pdf;
  }
}
