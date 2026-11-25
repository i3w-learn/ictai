import type { AuditEntry } from '@ict/contracts';

// The student a report-card line of the activity log is about. The server keeps the name in the
// line's detail (the card itself has no name of its own), so "published the report card of" can end
// with whose it is. null for any other line, and for an old line with no name kept.
export function cardStudent(e: Pick<AuditEntry, 'action' | 'detail'>): string | null {
  if (!e.action.startsWith('report_card.')) return null;
  const student = (e.detail as { student?: unknown } | null)?.student;
  return typeof student === 'string' && student.trim() ? student : null;
}
