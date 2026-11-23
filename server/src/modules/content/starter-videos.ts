import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Clock } from '../../core/clock.js';
import type { EventLog } from '../../core/event-log.js';
import type { ClassRepository } from '../students/class.repository.js';
import type { ContentRepository } from './content.repository.js';
import { DISK_RESERVE_BYTES } from './content.service.js';
import type { FileStore } from './file-store.js';
import { LOCK_EXT } from './lock.js';
import { sniff } from './sniff.js';

const SUBJECTS: Record<string, string> = { mat: 'Maths', sci: 'Science', eng: 'English', hin: 'Hindi', sst: 'Social Science', evs: 'EVS', com: 'Computer' };

// Where a starter video or book is filed, read from its file name. They come named like
//   "G6-Mar-Mat-06Int11-Addition of Integers -Part 1-DMV-ILL.mp4"
// which is: class, language, subject, lesson code, title, and codes of whoever made it.
// A name that does not begin with a class ("G6") gives null: the server cannot guess the class.
export function filingFromName(fileName: string): { className: string; subject: string | null; title: string } | null {
  const parts = fileName.replace(/\.[^.]+$/, '').split('-').map((p) => p.trim().replace(/\s+/g, ' ')).filter(Boolean);
  const grade = /^G(\d{1,2})$/i.exec(parts[0] ?? '');
  if (!grade) return null;
  const rest = parts.slice(1);
  // The makers' codes at the end are short and all capitals ("DMV", "ILL"); a title is not.
  while (rest.length > 1 && /^[A-Z]{2,4}$/.test(rest.at(-1)!)) rest.pop();
  // The title is what is left after the short codes in front (language, subject, lesson code).
  const from = rest.findIndex((p) => p.includes(' ') || p.length > 8);
  const title = (from < 0 ? rest.slice(-1) : rest.slice(from)).join(' - ').slice(0, 120);
  // The language comes before the subject ("Eng-Sci" is Science taught in English), so the last code that names a subject wins.
  const subject = (from < 0 ? rest.slice(0, -1) : rest.slice(0, from)).map((p) => SUBJECTS[p.toLowerCase()]).filter(Boolean).at(-1) ?? null;
  return { className: String(Number(grade[1])), subject, title };
}

// Videos (.mp4, .webm) and books (.pdf) that come with the app. The installer puts them in a folder beside
// the server; the server adds each one to the library once. Ours come locked (".mp4.ictlock", see lock.ts)
// and stay locked on this PC's disk: the copy in the library is as unreadable outside the app as the one here. A teacher may remove one afterwards and it stays removed,
// because the names already added are written down in the data folder.
export class StarterVideos {
  constructor(
    private readonly dir: string,
    private readonly doneFile: string,
    private readonly now: Clock,
    private readonly content: ContentRepository,
    private readonly store: FileStore,
    private readonly classes: ClassRepository,
    // A library item belongs to a person: the school's first Super Admin. Until one is made, nothing is added.
    private readonly owner: () => string | undefined,
    private readonly log: EventLog,
  ) {}

  // Adds what is not yet added. True when nothing is left to do, so the caller can stop asking.
  async sync(): Promise<boolean> {
    if (!existsSync(this.dir)) return true;
    const done = new Set<string>(existsSync(this.doneFile) ? (JSON.parse(readFileSync(this.doneFile, 'utf8')) as string[]) : []);
    const waiting = readdirSync(this.dir).filter((f) => /\.(mp4|webm|pdf)(\.ictlock)?$/i.test(f) && !done.has(f)).sort();
    if (waiting.length === 0) return true;
    const by = this.owner();
    if (!by) return false;

    for (const onDisk of waiting) {
      const path = join(this.dir, onDisk);
      const locked = onDisk.toLowerCase().endsWith(LOCK_EXT);
      // The name the file had before it was locked: that is the one people see.
      const name = locked ? onDisk.slice(0, -LOCK_EXT.length) : onDisk;
      const filing = filingFromName(name);
      const isBook = /\.pdf$/i.test(name);
      const what = isBook ? 'book' : 'video';
      const size = statSync(path).size;
      if (locked && !this.store.canUnlock) {
        // Not written down as done: a server that has the key adds it.
        this.log(`starter.${what}.skipped`, { file: name, why: 'it is locked and this server was built without the key that opens it' });
        continue;
      } else if (!filing) {
        this.log(`starter.${what}.skipped`, { file: name, why: 'the name does not start with a class, like "G6-"' });
      } else if (this.store.freeBytes() - size < DISK_RESERVE_BYTES) {
        // Not written down as done: it is tried again when the server next starts.
        this.log(`starter.${what}.skipped`, { file: name, why: 'the disk is almost full' });
        continue;
      } else {
        const partId = this.store.newPart();
        this.store.copyIn(partId, path);
        const type = sniff(this.store.head(partId));
        const kind = isBook ? 'pdf' : 'video';
        if (type?.kind !== kind) {
          this.store.discard(partId);
          this.log(`starter.${what}.skipped`, { file: name, why: isBook ? 'it is not a PDF book' : 'it is not a video the app can play (MP4 or WebM)' });
        } else {
          const kept = await this.store.keep(partId);
          const now = this.now();
          const cls = this.classes.listClasses().find((c) => c.name === filing.className) ?? this.classes.insertClass(filing.className, now);
          this.content.addFile(kept.hash, kept.size, type.mime, now);
          this.content.insert({ id: randomUUID(), title: filing.title, kind, classId: cls.id, subject: filing.subject, chapter: null, fileHash: kept.hash, fileName: name, url: null, by, now });
          this.log(`starter.${what}.added`, { [what]: filing.title, class: cls.name, subject: filing.subject });
        }
      }
      done.add(onDisk);
      writeFileSync(this.doneFile, JSON.stringify([...done], null, 2));
    }
    return true;
  }
}
