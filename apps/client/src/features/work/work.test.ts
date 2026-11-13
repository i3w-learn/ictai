import { describe, expect, it } from 'vitest';
import type { MyWork } from '@ict/contracts';
import { endOfDay, sortWork } from './work';

const w = (id: string, status: MyWork['status'], dueAt: number | null = null, overdue = false): MyWork =>
  ({ id, title: id, instructions: '', subject: null, dueAt, maxMarks: 10, byName: 'T', status, overdue, answer: null, mark: null });

describe('my work', () => {
  it('puts work still to do first, overdue on top, then the soonest due', () => {
    const list = [w('marked', 'marked'), w('later', 'todo', 300), w('handed', 'submitted'), w('no-date', 'todo'), w('overdue', 'todo', 50, true), w('soon', 'todo', 100)];
    expect(sortWork(list).map((x) => x.id)).toEqual(['overdue', 'soon', 'later', 'no-date', 'handed', 'marked']);
  });

  it('treats a due date as the end of that day', () => {
    const end = new Date(endOfDay('2026-11-14'));
    expect([end.getDate(), end.getHours(), end.getMinutes()]).toEqual([14, 23, 59]);
  });
});
