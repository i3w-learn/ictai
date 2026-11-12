import { randomUUID } from 'node:crypto';
import { MAX_NOTES_PER_STUDENT, type Note, type NoteInput, type StudentPrincipal } from '@ict/contracts';
import type { Clock } from '../../core/clock.js';
import { AppError, notFound } from '../../core/errors.js';
import type { NoteRepository } from './note.repository.js';

// "My notes": each student's own notebook. Someone else's note looks the same as a missing one,
// so nobody can tell which notes exist.
export class NoteService {
  constructor(
    private readonly now: Clock,
    private readonly notes: NoteRepository,
  ) {}

  list(me: StudentPrincipal): Note[] {
    return this.notes.list(me.studentId);
  }

  create(me: StudentPrincipal, input: NoteInput): Note {
    if (this.notes.count(me.studentId) >= MAX_NOTES_PER_STUDENT) {
      throw new AppError(409, 'NOTE_LIMIT', `You can keep ${MAX_NOTES_PER_STUDENT} notes. Delete one you no longer need first.`);
    }
    const id = randomUUID();
    this.notes.insert(id, me.studentId, input, this.now());
    return this.notes.get(id, me.studentId)!;
  }

  replace(me: StudentPrincipal, id: string, input: NoteInput): Note {
    if (!this.notes.update(id, me.studentId, input, this.now())) throw notFound('Note');
    return this.notes.get(id, me.studentId)!;
  }

  remove(me: StudentPrincipal, id: string) {
    if (!this.notes.remove(id, me.studentId)) throw notFound('Note');
  }
}
