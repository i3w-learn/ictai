import { z } from 'zod';
import { Id } from './common.js';

// PRD 4.2 "Content" and student app "My books": the school's library of files and links, filed by
// class, subject and chapter. A file travels between the app and the server in small pieces, so the
// same safe channel the rest of the app uses carries it. That sets today's size limit: a big video
// needs a streaming path the app does not have yet.
export const CHUNK_BYTES = 512 * 1024;
export const MAX_FILE_BYTES = 100 * 1024 * 1024;

export const ContentKind = z.enum(['pdf', 'image', 'video', 'audio', 'link']);
export type ContentKind = z.infer<typeof ContentKind>;

const Filing = {
  title: z.string().trim().min(1, 'Give it a title').max(120),
  classId: Id,
  subject: z.string().trim().max(60).nullable().default(null).transform((s) => s || null),
  chapter: z.string().trim().max(80).nullable().default(null).transform((s) => s || null),
};

export const StartUpload = z.object({
  fileName: z.string().trim().min(1).max(200),
  size: z.number().int().min(1, 'The file is empty').max(MAX_FILE_BYTES, `The file is too big. The limit is ${MAX_FILE_BYTES / 1024 / 1024} MB.`),
});
export const UploadTicket = z.object({ uploadId: z.string(), chunkBytes: z.number(), chunks: z.number() });
export type UploadTicket = z.infer<typeof UploadTicket>;
// One piece of the file, base64. Pieces are sent in order, starting at 0.
export const UploadChunk = z.object({ index: z.number().int().min(0), data: z.string().min(1).max(Math.ceil((CHUNK_BYTES * 4) / 3) + 8) });
export const FinishUpload = z.object(Filing);
export type FinishUpload = z.infer<typeof FinishUpload>;

export const LinkInput = z.object({
  ...Filing,
  url: z.string().trim().max(500).refine((u) => /^https?:\/\/\S+\.\S+/.test(u), 'Type a full web address starting with http:// or https://'),
});
export type LinkInput = z.infer<typeof LinkInput>;

export const ContentItem = z.object({
  id: z.string(),
  title: z.string(),
  kind: ContentKind,
  classId: z.string(),
  className: z.string(),
  subject: z.string().nullable(),
  chapter: z.string().nullable(),
  // A file's fingerprint (SHA-256). Two uploads of the same file share one copy on disk.
  fileHash: z.string().nullable(),
  fileName: z.string().nullable(),
  size: z.number().nullable(),
  mime: z.string().nullable(),
  url: z.string().nullable(),
  // A link only works when the lab has internet; the screens say so.
  needsInternet: z.boolean(),
  byName: z.string(),
  createdAt: z.number(),
});
export type ContentItem = z.infer<typeof ContentItem>;

export const ContentQuery = z.object({ classId: Id.optional() });
export const FileChunkParams = z.object({ hash: z.string().regex(/^[0-9a-f]{64}$/), index: z.coerce.number().int().min(0) });
export const FileChunk = z.object({ data: z.string(), last: z.boolean() });
export type FileChunk = z.infer<typeof FileChunk>;

export const chunksOf = (size: number) => Math.max(1, Math.ceil(size / CHUNK_BYTES));
