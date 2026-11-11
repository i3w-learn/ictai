import type { Note, NoteInput } from '@ict/contracts';
import { ApiCallError } from '../../core/api-client';

// What the student is typing. `id` is null until the note has been saved once.
export interface Draft {
  id: string | null;
  title: string;
  subject: string;
  body: string;
}

export const BLANK: Draft = { id: null, title: '', subject: '', body: '' };

export const draftOf = (n: Note): Draft => ({ id: n.id, title: n.title, subject: n.subject ?? '', body: n.body });

// A note with no title still saves, under a plain name, so a student never loses what they typed.
export const toInput = (d: Draft): NoteInput => ({
  title: d.title.trim() || 'Untitled note',
  subject: d.subject.trim() || null,
  body: d.body,
});

// Has the student typed something the server does not have yet? Compares what would be sent,
// so stray spaces around the title, or an empty title on an "Untitled note", do not count.
export function isDirty(d: Draft, saved: Note | undefined): boolean {
  if (!saved) return d.title.trim() !== '' || d.subject.trim() !== '' || d.body.trim() !== '';
  const now = toInput(d);
  return now.title !== saved.title || now.subject !== saved.subject || now.body !== saved.body;
}

// The open note after a save came back. The student may have kept typing while the save was on
// its way, so their text stays exactly as it is; the note only gains its id. An empty title box
// stays empty (the list shows "Untitled note"), so a name never appears under the cursor.
export function afterSave(current: Draft | null, sent: Draft, note: Note): Draft | null {
  if (!current || current.id !== sent.id) return current;
  return { ...current, id: note.id };
}

export interface NotesApi {
  create(body: NoteInput): Promise<Note>;
  update(id: string, body: NoteInput): Promise<Note>;
}

// Sends a note to the server. If it was deleted meanwhile (say, on another PC), the text is
// saved as a new note rather than lost.
export async function saveDraft(api: NotesApi, d: Draft): Promise<Note> {
  const body = toInput(d);
  if (!d.id) return api.create(body);
  try {
    return await api.update(d.id, body);
  } catch (e) {
    if (e instanceof ApiCallError && e.status === 404) return api.create(body);
    throw e;
  }
}

// One line of the note for the list.
export function snippet(body: string, max = 80): string {
  const line = body.split('\n').map((l) => l.trim()).find(Boolean) ?? '';
  return line.length > max ? `${line.slice(0, max)}…` : line;
}

// The subjects this student has already used, offered as suggestions.
export function subjectsOf(notes: Note[]): string[] {
  const seen = new Map<string, string>();
  for (const n of notes) if (n.subject && !seen.has(n.subject.toLowerCase())) seen.set(n.subject.toLowerCase(), n.subject);
  return [...seen.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
}
