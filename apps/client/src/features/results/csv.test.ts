import { describe, expect, it } from 'vitest';
import type { StudentResultRow } from '@ict/contracts';
import { toCsv } from './csv';

const row = (over: Partial<StudentResultRow>): StudentResultRow => ({
  id: 'x', name: 'Asha', rollNo: '2', classId: 'c', className: '7', sectionName: 'A', attempts: 3, average: 80, band: 'great', ...over,
});

describe('toCsv', () => {
  it('starts with a BOM so Excel reads Hindi', () => expect(toCsv([]).startsWith('﻿')).toBe(true));

  it('writes a header and plain-word groups', () => {
    const lines = toCsv([row({ band: 'needs', average: 10 })]).slice(1).split('\r\n');
    expect(lines[0]).toBe('Name,Roll no,Class,Section,Quizzes taken,Average %,Group');
    expect(lines[1]).toBe('Asha,2,7,A,3,10,Needs you');
  });

  it('quotes commas and quotes, keeps Hindi, leaves blanks for missing values', () => {
    const lines = toCsv([
      row({ name: 'Sharma, "Asha"' }),
      row({ name: 'आशा', rollNo: null, sectionName: null, attempts: 0, average: null, band: 'none' }),
    ]).slice(1).split('\r\n');
    expect(lines[1]).toBe('"Sharma, ""Asha""",2,7,A,3,80,Doing great');
    expect(lines[2]).toBe('आशा,,7,,0,,Not started');
  });

  it('stops a name that starts like a formula from running in Excel', () => {
    const lines = toCsv([row({ name: '=HYPERLINK("x")' }), row({ name: '@Asha' })]).slice(1).split('\r\n');
    expect(lines[1]!.startsWith(`"'=HYPERLINK(""x"")"`)).toBe(true);
    expect(lines[2]!.startsWith("'@Asha,")).toBe(true);
  });
});
