import { randomUUID } from 'node:crypto';
import { CHUNK_BYTES, chunksOf, type ContentItem, type FileChunk, type FinishUpload, type LinkInput, type Principal, type StaffPrincipal, type StudentPrincipal, type UploadTicket } from '@ict/contracts';
import type { AuditLog } from '../../core/audit.js';
import type { Clock } from '../../core/clock.js';
import { AppError, forbidden, notFound } from '../../core/errors.js';
import { checkMyClass, checkSubject, scopeOf, seesClass, seesQuiz, type Scope } from '../../core/scope.js';
import type { ClassRepository } from '../students/class.repository.js';
import type { ContentRepository } from './content.repository.js';
import type { FileStore } from './file-store.js';
import { sniff } from './sniff.js';

// An upload in progress. Kept in memory: it does not survive a restart, the person uploads again.
interface Upload { by: string; fileName: string; size: number; received: number; next: number; startedAt: number }
// An upload nobody has added to for this long is dropped, so abandoned files do not pile up.
const UPLOAD_IDLE_MS = 30 * 60_000;
const MAX_OPEN_UPLOADS = 20;

// PRD "Content" (library) and "My books". Staff file things under a class, subject and chapter;
// a teacher only for her own classes and subjects. A student sees and opens only their own class's items.
export class ContentService {
  private readonly uploads = new Map<string, Upload>();

  constructor(
    private readonly now: Clock,
    private readonly content: ContentRepository,
    private readonly store: FileStore,
    private readonly classes: ClassRepository,
    private readonly audit: AuditLog,
  ) {}

  list(actor: StaffPrincipal, classId?: string): ContentItem[] {
    const scope = scopeOf(actor);
    if (classId) checkMyClass(this.classes, scope, classId);
    return this.content.all(classId).filter((i) => seesQuiz(scope, i));
  }

  forStudent(me: StudentPrincipal): ContentItem[] {
    return this.content.all(me.classId);
  }

  startUpload(actor: StaffPrincipal, fileName: string, size: number): UploadTicket {
    this.dropStale();
    if (this.uploads.size >= MAX_OPEN_UPLOADS) throw new AppError(429, 'BUSY', 'Too many uploads are in progress. Wait a minute and try again.');
    const id = this.store.newPart();
    this.uploads.set(id, { by: actor.userId, fileName, size, received: 0, next: 0, startedAt: this.now() });
    return { uploadId: id, chunkBytes: CHUNK_BYTES, chunks: chunksOf(size) };
  }

  addChunk(actor: StaffPrincipal, id: string, index: number, data: string) {
    const up = this.mineUpload(actor, id);
    if (index !== up.next) throw new AppError(409, 'OUT_OF_ORDER', `Send piece ${up.next} next.`);
    const bytes = Buffer.from(data, 'base64');
    const last = index === chunksOf(up.size) - 1;
    // Every piece but the last is exactly one piece long, and the total never passes the size promised.
    if (bytes.length === 0 || bytes.length > CHUNK_BYTES || (!last && bytes.length !== CHUNK_BYTES) || up.received + bytes.length > up.size) {
      this.cancel(id);
      throw new AppError(400, 'BAD_REQUEST', 'The file did not arrive in one piece. Upload it again.');
    }
    this.store.append(id, bytes);
    up.received += bytes.length;
    up.next += 1;
    up.startedAt = this.now();
  }

  async finishUpload(actor: StaffPrincipal, id: string, filing: FinishUpload): Promise<ContentItem> {
    const up = this.mineUpload(actor, id);
    const scope = scopeOf(actor);
    try {
      this.checkFiling(scope, filing);
      if (up.received !== up.size) throw new AppError(400, 'BAD_REQUEST', 'The file did not arrive in one piece. Upload it again.');
      const type = sniff(this.store.head(id));
      if (!type) throw new AppError(415, 'UNSUPPORTED_FILE', 'This kind of file cannot be added. Use a PDF, a picture (PNG, JPG, GIF, WebP), a video (MP4, WebM) or sound (MP3, WAV, OGG, M4A).');
      const { hash, size } = await this.store.keep(id);
      this.uploads.delete(id);
      const now = this.now();
      this.content.addFile(hash, size, type.mime, now);
      const itemId = randomUUID();
      this.content.insert({ id: itemId, title: filing.title, kind: type.kind, classId: filing.classId, subject: filing.subject, chapter: filing.chapter, fileHash: hash, fileName: up.fileName, url: null, by: actor.userId, now });
      this.audit.record({ kind: 'staff', id: actor.userId }, 'content.add', itemId, { title: filing.title, kind: type.kind });
      return this.content.get(itemId)!;
    } catch (e) {
      this.cancel(id);
      throw e;
    }
  }

  addLink(actor: StaffPrincipal, input: LinkInput): ContentItem {
    this.checkFiling(scopeOf(actor), input);
    const id = randomUUID();
    this.content.insert({ id, title: input.title, kind: 'link', classId: input.classId, subject: input.subject, chapter: input.chapter, fileHash: null, fileName: null, url: input.url, by: actor.userId, now: this.now() });
    this.audit.record({ kind: 'staff', id: actor.userId }, 'content.add', id, { title: input.title, kind: 'link' });
    return this.content.get(id)!;
  }

  // Removing the last library item that uses a file removes the file from the disk too.
  remove(actor: StaffPrincipal, id: string) {
    const item = this.content.get(id);
    if (!item || !seesQuiz(scopeOf(actor), item)) throw notFound('Library item');
    this.content.remove(id, this.now());
    if (item.fileHash && !this.content.fileInUse(item.fileHash)) {
      // The record goes first: if that failed, the file would still be on disk and nothing would be lost.
      this.content.forgetFile(item.fileHash);
      this.store.remove(item.fileHash);
    }
    this.audit.record({ kind: 'staff', id: actor.userId }, 'content.delete', id, { title: item.title });
  }

  // A file is read by its fingerprint. Knowing a fingerprint is not enough: a student must have the file
  // in their own class's library, and a teacher in one of her classes.
  fileChunk(who: Principal, hash: string, index: number): FileChunk {
    if (who.kind === 'student') {
      if (!this.content.fileForClass(hash, who.classId)) throw notFound('File');
    } else if (who.kind === 'staff') {
      const scope = scopeOf(who);
      if (!this.content.classesOfFile(hash).some((c) => seesClass(scope, c))) throw notFound('File');
    } else throw forbidden('Sign in to open this file.');
    const piece = this.store.chunk(hash, index);
    if (!piece) throw notFound('File');
    return { data: piece.bytes.toString('base64'), last: piece.last };
  }

  private checkFiling(scope: Scope, f: { classId: string; subject: string | null }) {
    checkMyClass(this.classes, scope, f.classId);
    checkSubject(scope, f.subject);
  }

  private mineUpload(actor: StaffPrincipal, id: string): Upload {
    const up = this.uploads.get(id);
    if (!up || up.by !== actor.userId) throw notFound('Upload');
    return up;
  }

  private cancel(id: string) {
    this.uploads.delete(id);
    this.store.discard(id);
  }

  private dropStale() {
    for (const [id, up] of this.uploads) if (this.now() - up.startedAt > UPLOAD_IDLE_MS) this.cancel(id);
  }
}
