import { describe, expect, it } from 'vitest';
import type { Note } from '@ict/contracts';
import { ApiCallError } from '../../core/api-client';
import { afterSave, BLANK, draftOf, isDirty, saveDraft, snippet, subjectsOf, toInput } from './notes';

const note = (over: Partial<Note> = {}): Note => ({ id: 'n1', title: 'Light', body: 'Plants need light.', subject: 'Science', createdAt: 1, updatedAt: 2, ...over });

describe('toInput', () => {
  it('trims the title and subject and keeps the text as typed', () => {
    expect(toInput({ id: null, title: '  Light ', subject: ' Science ', body: ' line 1\nline 2 ' })).toEqual({ title: 'Light', subject: 'Science', body: ' line 1\nline 2 ' });
  });

  it('names a note with no title, so it can always be saved', () => {
    expect(toInput({ ...BLANK, body: 'text' }).title).toBe('Untitled note');
  });

  it('sends no subject when the box is empty', () => {
    expect(toInput({ ...BLANK, title: 'x', subject: '   ' }).subject).toBeNull();
  });
});

describe('isDirty', () => {
  it('is false for a note just opened', () => expect(isDirty(draftOf(note()), note())).toBe(false));
  it('is false for a note with no subject just opened', () => expect(isDirty(draftOf(note({ subject: null })), note({ subject: null }))).toBe(false));
  it('is true once the text changes', () => expect(isDirty({ ...draftOf(note()), body: 'More.' }, note())).toBe(true));
  it('is false for an empty new note', () => expect(isDirty(BLANK, undefined)).toBe(false));
  it('is true for a new note with something typed', () => expect(isDirty({ ...BLANK, body: 'a' }, undefined)).toBe(true));
  it('is false for a new note with only spaces typed', () => expect(isDirty({ ...BLANK, title: ' ', body: ' \n' }, undefined)).toBe(false));
  it('is false when only spaces around the title or subject changed', () => {
    expect(isDirty({ ...draftOf(note()), title: ' Light ', subject: 'Science ' }, note())).toBe(false);
  });
  it('is false for a note saved without a title whose title box is still empty', () => {
    expect(isDirty({ id: 'n1', title: '', subject: '', body: 'x' }, note({ title: 'Untitled note', subject: null, body: 'x' }))).toBe(false);
  });
});

describe('afterSave', () => {
  const sent = { ...BLANK, title: 'Light', body: 'Plants' };

  it('gives a new note its id', () => {
    expect(afterSave(sent, sent, note({ id: 'n9' }))).toEqual({ ...sent, id: 'n9' });
  });

  it('keeps what the student typed while the save was on its way', () => {
    const typedMeanwhile = { ...sent, body: 'Plants need light' };
    expect(afterSave(typedMeanwhile, sent, note({ id: 'n9', body: 'Plants' }))).toEqual({ ...typedMeanwhile, id: 'n9' });
  });

  it('leaves an empty title box empty, so no name appears while the student is about to type one', () => {
    const untitled = { ...BLANK, body: 'x' };
    expect(afterSave(untitled, untitled, note({ title: 'Untitled note' }))?.title).toBe('');
  });

  it('leaves another note alone if the student has moved on', () => {
    const other = { id: 'n2', title: 'Other', subject: '', body: '' };
    expect(afterSave(other, sent, note({ id: 'n9' }))).toBe(other);
    expect(afterSave(null, sent, note({ id: 'n9' }))).toBeNull();
  });
});

describe('saveDraft', () => {
  const gone = () => Promise.reject(new ApiCallError(404, 'NOT_FOUND', 'Note not found.'));

  it('creates a note that has no id yet', async () => {
    const calls: string[] = [];
    const api = { create: async () => { calls.push('create'); return note(); }, update: async () => { calls.push('update'); return note(); } };
    await saveDraft(api, { ...BLANK, title: 'Light' });
    expect(calls).toEqual(['create']);
  });

  it('updates a note that has an id', async () => {
    const seen: unknown[] = [];
    const api = { create: async () => note(), update: async (id: string, body: unknown) => { seen.push(id, body); return note(); } };
    await saveDraft(api, draftOf(note()));
    expect(seen).toEqual(['n1', { title: 'Light', subject: 'Science', body: 'Plants need light.' }]);
  });

  it('saves the text as a new note when the old one was deleted on another PC', async () => {
    const api = { create: async () => note({ id: 'fresh' }), update: gone };
    expect((await saveDraft(api, draftOf(note()))).id).toBe('fresh');
  });

  it('passes on any other failure', async () => {
    const down = () => Promise.reject(new ApiCallError(0, 'SERVER_UNREACHABLE', 'Cannot reach the school server.'));
    await expect(saveDraft({ create: async () => note(), update: down }, draftOf(note()))).rejects.toThrow('Cannot reach');
  });
});

describe('snippet', () => {
  it('shows the first line that has words', () => expect(snippet('\n\n  First line \nSecond')).toBe('First line'));
  it('cuts a long line short', () => expect(snippet('a'.repeat(200))).toBe(`${'a'.repeat(80)}…`));
  it('is empty for an empty note', () => expect(snippet('  \n ')).toBe(''));
});

describe('subjectsOf', () => {
  it('lists each subject once, ignoring capitals, in A–Z order', () => {
    const notes = [note({ subject: 'Science' }), note({ subject: 'maths' }), note({ subject: 'science' }), note({ subject: null })];
    expect(subjectsOf(notes)).toEqual(['maths', 'Science']);
  });
});
