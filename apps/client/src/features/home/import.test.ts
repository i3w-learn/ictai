import { describe, expect, it } from 'vitest';
import { translate, type T } from '../../i18n/i18n';
import { parseCsv, toImportRows } from './import';

const t: T = (text, vars) => translate('en', text, vars);

describe('parseCsv', () => {
  it('reads quoted cells, doubled quotes and commas inside quotes', () => {
    expect(parseCsv('a,"b, c","d ""e"""\r\n1,2,3')).toEqual([['a', 'b, c', 'd "e"'], ['1', '2', '3']]);
  });

  it('drops the Excel marker at the start and blank lines', () => {
    expect(parseCsv('﻿आशा,1\n\n,\nKabir,2\n')).toEqual([['आशा', '1'], ['Kabir', '2']]);
  });

  it('keeps a line break inside a quoted cell', () => {
    expect(parseCsv('"two\nlines",x')).toEqual([['two\nlines', 'x']]);
  });
});

describe('toImportRows', () => {
  it('finds columns by their headings, in any order', () => {
    expect(toImportRows('Roll No,Section,Student Name\n7,A,Asha\n,,Kabir', t)).toEqual({
      firstLine: 2, rows: [{ name: 'Asha', rollNo: '7', section: 'A' }, { name: 'Kabir', rollNo: null, section: null }],
    });
  });

  it('reads name, roll, section when there is no heading row', () => {
    expect(toImportRows('Asha,7,A\nKabir', t)).toEqual({
      firstLine: 1, rows: [{ name: 'Asha', rollNo: '7', section: 'A' }, { name: 'Kabir', rollNo: null, section: null }],
    });
  });

  it('explains an empty file, a heading with no students, and too many students', () => {
    expect(toImportRows(' \n', t)).toEqual({ problem: 'This file is empty.' });
    expect(toImportRows('Name,Roll', t)).toEqual({ problem: 'This file has a heading row but no students.' });
    const many = Array.from({ length: 501 }, (_, i) => `S${i}`).join('\n');
    expect(toImportRows(many, t)).toEqual({ problem: 'This file has 501 students. Add at most 500 at a time.' });
  });
});
