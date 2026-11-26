import { createElement, Fragment, type ReactNode } from 'react';
import type { AuditEntry } from '@ict/contracts';

// The student a report-card line of the activity log is about. The server keeps the name in the
// line's detail (the card itself has no name of its own), so "published the report card of" can end
// with whose it is. null for any other line, and for an old line with no name kept.
export function cardStudent(e: Pick<AuditEntry, 'action' | 'detail'>): string | null {
  if (!e.action.startsWith('report_card.')) return null;
  const student = (e.detail as { student?: unknown } | null)?.student;
  return typeof student === 'string' && student.trim() ? student : null;
}

// Puts a bold name, a button's name and the like into a sentence that is already translated. The
// sentence comes from t() with its {marks} not filled in, so each language puts a mark where it
// belongs; every {mark} named in `parts` is then swapped for that piece of the screen.
export function rich(sentence: string, parts: Record<string, ReactNode>): ReactNode[] {
  return sentence.split(/(\{\w+\})/).map((piece, i) => {
    const name = /^\{(\w+)\}$/.exec(piece)?.[1];
    return createElement(Fragment, { key: i }, name !== undefined && name in parts ? parts[name] : piece);
  });
}
