import type { Band, StudentResultRow } from '@ict/contracts';
import { tk } from '../../i18n/i18n';

export const BAND_LABEL: Record<Band, string> = { great: tk('Doing great'), growing: tk('Growing'), needs: tk('Needs you'), none: tk('Not started') };

// Text starting with = + - @ would run as a formula in Excel, so it gets a leading apostrophe.
const cell = (v: string | number | null) => {
  let s = v == null ? '' : String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

// A file Excel opens directly. The BOM makes Excel read Hindi names correctly. The column names and
// the group words stay in English in the file, whatever language the screen is in, because other
// programs read it.
export function toCsv(rows: StudentResultRow[]): string {
  const lines = [
    ['Name', 'Roll no', 'Class', 'Section', 'Quizzes taken', 'Average %', 'Group'],
    ...rows.map((r) => [r.name, r.rollNo, r.className, r.sectionName, r.attempts, r.average, BAND_LABEL[r.band]]),
  ];
  return '﻿' + lines.map((l) => l.map(cell).join(',')).join('\r\n');
}

export function downloadCsv(fileName: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.click();
  // Freed a moment later: freeing it at once can cancel the download in the desktop app's web view.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
