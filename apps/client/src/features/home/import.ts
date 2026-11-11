import { MAX_IMPORT_ROWS, type ImportStudents } from '@ict/contracts';

// Splits a CSV file (what Excel makes with "Save as → CSV") into rows of cells.
// Handles quoted cells, doubled quotes, and commas or line breaks inside quotes.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^﻿/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

type Rows = ImportStudents['rows'];

// Turns the file into student rows. With a heading row ("Name", "Roll no", "Section", in any
// order) the columns are found by their headings; without one they are read as name, roll, section.
// `firstLine` is the file line the first student is on, so problems can name the line as Excel shows it.
export function toImportRows(text: string): { rows: Rows; firstLine: number } | { problem: string } {
  const table = parseCsv(text);
  if (table.length === 0) return { problem: 'This file is empty.' };

  const head = table[0]!.map((h) => h.trim().toLowerCase());
  const find = (...words: string[]) => head.findIndex((h) => words.some((w) => h.includes(w)));
  const nameCol = find('name');
  const hasHeading = nameCol >= 0;
  const cols = hasHeading ? { name: nameCol, roll: find('roll'), section: find('section', 'sec') } : { name: 0, roll: 1, section: 2 };
  const body = hasHeading ? table.slice(1) : table;

  if (body.length === 0) return { problem: 'This file has a heading row but no students.' };
  if (body.length > MAX_IMPORT_ROWS) return { problem: `This file has ${body.length} students. Add at most ${MAX_IMPORT_ROWS} at a time.` };
  const at = (r: string[], col: number) => (col >= 0 ? r[col]?.trim() || null : null);
  return { firstLine: hasHeading ? 2 : 1, rows: body.map((r) => ({ name: (r[cols.name] ?? '').trim().slice(0, 200), rollNo: at(r, cols.roll)?.slice(0, 200) ?? null, section: at(r, cols.section)?.slice(0, 200) ?? null })) };
}
